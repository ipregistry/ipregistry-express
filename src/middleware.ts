/*
 * Copyright 2026 Ipregistry (https://ipregistry.co).
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { UserAgents, type IpregistryClient } from '@ipregistry/client'

import {
    createIpregistryClient,
    toErrorInfo,
    type IpregistryConnectionOptions,
} from './config.js'
import {
    anonymizeIp,
    createIpExtractor,
    isPrivateIp,
    isValidIp,
    type IpSource,
} from './ip.js'
import type { IpregistryContext, IpregistrySkipReason } from './types.js'

/**
 * Configuration of the `ipregistry()` middleware. Everything is optional:
 * with no configuration the middleware reads the API key from
 * `IPREGISTRY_API_KEY`, takes the client IP from `req.ip` (honoring the
 * app's `trust proxy` setting), caches lookups in memory, skips static
 * assets, and fails open.
 */
export interface IpregistryOptions extends IpregistryConnectionOptions {
    /**
     * Selects the Ipregistry response fields to fetch, as a comma-separated
     * list (e.g. 'ip,location,security'). Fewer fields mean faster lookups.
     * Defaults to `process.env.IPREGISTRY_FIELDS`, then to the full
     * response.
     */
    fields?: string

    /**
     * Whether to resolve the hostname of the client IP. Defaults to false.
     */
    hostname?: boolean

    /**
     * Where to read the client IP from: the 'express' preset (`req.ip`,
     * honoring `app.set('trust proxy', ...)` — the recommended default), the
     * 'cloudflare', 'nginx', or 'forwarded-for' presets, a single trusted
     * header (`{ header: 'x-client-ip' }`), or a custom extractor function.
     * Only configure headers your proxy actually overwrites, otherwise
     * clients can spoof their IP.
     */
    ipSource?: IpSource

    /**
     * A fixed IP address used when the extracted client IP is missing or
     * private, which is the norm on localhost. Handy in development to
     * exercise geo features; leave unset in production.
     */
    developmentIp?: string

    /**
     * Whether to skip lookups for static assets (favicon and common file
     * extensions). Defaults to true so assets never consume credits; set to
     * false if assets are served elsewhere (nginx, CDN) or before this
     * middleware and you want everything else enriched.
     */
    skipStaticAssets?: boolean

    /**
     * Whether to skip lookups for search bots and crawlers, identified by
     * user agent. Pass true to use the SDK's built-in heuristic, or a
     * regular expression tested against the User-Agent header. Defaults to
     * false.
     */
    skipBots?: boolean | RegExp

    /**
     * A custom predicate deciding whether to skip the lookup for a request.
     * Runs after the static-asset and bot checks.
     */
    skip?: (request: Request) => boolean

    /**
     * When the lookup fails (timeout, API error, missing key), the
     * middleware fails open by default: the request proceeds without data.
     * Set to true to respond with 503 instead, or to a number to choose the
     * status. Skipped lookups (static assets, bots, no IP) are unaffected.
     */
    failClosed?: boolean | number

    /**
     * Called when a lookup fails, before the fail-open/fail-closed decision.
     * Use it to report to your monitoring. The library itself never logs
     * full IP addresses; do the same in your handler.
     */
    onError?: (error: unknown, request: Request) => void

    /**
     * Whether to log skipped and failed lookups with `console.warn`
     * (IP addresses are anonymized). Defaults to false.
     */
    debug?: boolean
}

const STATIC_EXTENSIONS =
    /\.(?:avif|css|eot|gif|ico|jpe?g|js|json|map|mjs|mp3|mp4|otf|pdf|png|svg|ttf|txt|wasm|webm|webp|woff2?|xml)$/i

function isStaticAssetPath(pathname: string): boolean {
    return pathname === '/favicon.ico' || STATIC_EXTENSIONS.test(pathname)
}

/**
 * Creates an Express middleware that enriches requests with Ipregistry data.
 * The result is attached to the request as `req.ipregistry` (and mirrored on
 * `res.locals.ipregistry` for view engines) and stays available to every
 * later middleware and route handler.
 *
 * ```ts
 * import express from 'express'
 * import { ipregistry } from '@ipregistry/express'
 *
 * const app = express()
 * app.set('trust proxy', 1) // match your proxy topology
 *
 * app.use(ipregistry({ fields: 'ip,location,security' }))
 *
 * app.get('/', (req, res) => {
 *     res.send(`Hello ${req.ipregistry?.data?.location?.country?.name ?? 'visitor'}!`)
 * })
 * ```
 *
 * The middleware never throws and never rejects: on failure it fails open
 * (unless `failClosed` is set) and records the error on the context. It can
 * be mounted globally with `app.use` or per route; when a request already
 * carries a context (double mount, or `fakeIpregistry()` in tests) it is
 * left untouched.
 */
export function ipregistry(options: IpregistryOptions = {}): RequestHandler {
    if (options.developmentIp && !isValidIp(options.developmentIp)) {
        throw new TypeError(
            `[ipregistry] developmentIp '${options.developmentIp}' is not a ` +
                'valid IP address.',
        )
    }

    const extractIp = createIpExtractor(options.ipSource)
    const fields = options.fields ?? process.env.IPREGISTRY_FIELDS

    // The client is created on first request, not when the middleware is
    // built, so that a missing API key surfaces as a per-request fail-open
    // error instead of crashing the app at boot time.
    let client: IpregistryClient | undefined

    return function ipregistryMiddleware(
        request: Request,
        response: Response,
        next: NextFunction,
    ): void {
        if (request.ipregistry) {
            next()
            return
        }

        const skipped = resolveSkipReason(request, options)

        if (skipped) {
            finish(request, response, next, { ip: null, data: null, skipped })
            return
        }

        let ip = extractIp(request)

        if ((!ip || isPrivateIp(ip)) && options.developmentIp) {
            ip = options.developmentIp
        }

        if (!ip || isPrivateIp(ip)) {
            if (options.debug) {
                console.warn(
                    '[ipregistry] no public client IP found, skipping lookup',
                )
            }
            finish(request, response, next, {
                ip: null,
                data: null,
                skipped: 'no-ip',
            })
            return
        }

        const lookupIp = ip

        void (async () => {
            try {
                client ??= createIpregistryClient(options)
                const apiResponse = await client.lookupIp(lookupIp, {
                    ...(fields !== undefined ? { fields } : {}),
                    ...(options.hostname !== undefined
                        ? { hostname: options.hostname }
                        : {}),
                })
                finish(request, response, next, {
                    ip: lookupIp,
                    data: apiResponse.data,
                })
            } catch (error) {
                try {
                    options.onError?.(error, request)
                } catch {
                    // A throwing onError callback must not break the request.
                }

                if (options.debug) {
                    console.warn(
                        `[ipregistry] lookup failed for ${anonymizeIp(lookupIp)}:`,
                        error instanceof Error ? error.message : error,
                    )
                }

                if (options.failClosed) {
                    response
                        .status(
                            typeof options.failClosed === 'number'
                                ? options.failClosed
                                : 503,
                        )
                        .type('text/plain')
                        .send('Service temporarily unavailable.')
                    return
                }

                finish(request, response, next, {
                    ip: lookupIp,
                    data: null,
                    error: toErrorInfo(error),
                })
            }
        })()
    }
}

function finish(
    request: Request,
    response: Response,
    next: NextFunction,
    context: IpregistryContext,
): void {
    request.ipregistry = context
    response.locals.ipregistry = context
    next()
}

function resolveSkipReason(
    request: Request,
    options: IpregistryOptions,
): IpregistrySkipReason | null {
    // originalUrl (unlike req.path) is unaffected by router mount points.
    const queryIndex = request.originalUrl.indexOf('?')
    const pathname =
        queryIndex === -1
            ? request.originalUrl
            : request.originalUrl.slice(0, queryIndex)

    if (options.skipStaticAssets !== false && isStaticAssetPath(pathname)) {
        return 'static-asset'
    }

    if (options.skipBots) {
        const userAgent = request.headers['user-agent']

        if (userAgent) {
            const isBot =
                options.skipBots instanceof RegExp
                    ? options.skipBots.test(userAgent)
                    : UserAgents.isBot(userAgent)

            if (isBot) {
                return 'bot'
            }
        }
    }

    if (options.skip?.(request)) {
        return 'custom'
    }

    return null
}
