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

import { isThreat, type ThreatOptions } from './guards.js'
import type { IpregistryContext } from './types.js'

/**
 * A custom responder replacing the default plain-text blocking response.
 * It fully owns the response: set the status and send the body yourself.
 */
export type BlockResponder = (
    context: IpregistryContext,
    request: Request,
    response: Response,
) => void

export interface BlockCountriesOptions {
    /**
     * ISO 3166-1 alpha-2 country codes (e.g. 'FR', 'US'), case-insensitive.
     */
    countries: string[]

    /**
     * The plain-text body of the blocking response. Defaults to 'Access
     * restricted in your region.'
     */
    message?: string

    /**
     * 'block' (default) denies the listed countries; 'allow' denies every
     * country except the listed ones.
     */
    mode?: 'block' | 'allow'

    /**
     * A custom responder replacing the default plain-text response.
     */
    response?: BlockResponder

    /**
     * The HTTP status of the blocking response. Defaults to 451 (Unavailable
     * For Legal Reasons).
     */
    status?: number

    /**
     * What to do when the country is unknown: no `location.country.code` in
     * the response, or no data at all because the lookup was skipped
     * (private IP, bot) or failed. Defaults to 'allow' (fail-open).
     */
    unknown?: 'allow' | 'block'
}

/**
 * Creates a middleware that blocks (or exclusively allows) visitors by
 * country, based on `location.country.code`. Mount it after `ipregistry()`,
 * whose lookup must include the `location` fields:
 *
 * ```ts
 * app.use(ipregistry({ fields: 'ip,location' }))
 * app.use(blockCountries({ countries: ['KP', 'IR'] })) // 451 by default
 * ```
 *
 * Works globally, per router, or per route. Fails open by default when the
 * country is unknown; pass `unknown: 'block'` to fail closed.
 */
export function blockCountries(options: BlockCountriesOptions): RequestHandler {
    for (const code of options.countries) {
        assertCountryCode(code, 'blockCountries()')
    }

    const countries = new Set(
        options.countries.map((code) => code.toUpperCase()),
    )
    const mode = options.mode ?? 'block'
    const status = options.status ?? 451
    const message = options.message ?? 'Access restricted in your region.'

    return function blockCountriesMiddleware(request, response, next) {
        const context = requireContext(request, next, 'blockCountries()')

        if (!context) {
            return
        }

        const code = context.data?.location?.country?.code?.toUpperCase()

        let blocked: boolean

        if (!code) {
            blocked = options.unknown === 'block'
        } else {
            blocked =
                mode === 'block' ? countries.has(code) : !countries.has(code)
        }

        if (!blocked) {
            next()
            return
        }

        if (options.response) {
            options.response(context, request, response)
            return
        }

        response.status(status).type('text/plain').send(message)
    }
}

export interface BlockThreatsOptions extends ThreatOptions {
    /**
     * The plain-text body of the blocking response. Defaults to
     * 'Access denied.'
     */
    message?: string

    /**
     * A custom responder replacing the default plain-text response.
     */
    response?: BlockResponder

    /**
     * The HTTP status of the blocking response. Defaults to 403.
     */
    status?: number

    /**
     * What to do when no security data is available because the lookup was
     * skipped (private IP, bot) or failed. Defaults to 'allow' (fail-open).
     */
    unknown?: 'allow' | 'block'
}

/**
 * Creates a middleware that blocks visitors whose IP is flagged by
 * Ipregistry security data. By default blocks `is_threat`, `is_attacker`,
 * and `is_abuser`; enable `proxy`, `tor`, `vpn`, `relay`... to also block
 * anonymized traffic. Mount it after `ipregistry()`, whose lookup must
 * include the `security` fields:
 *
 * ```ts
 * app.use(ipregistry({ fields: 'ip,security' }))
 * app.use(blockThreats({ tor: true, vpn: true })) // 403 by default
 * ```
 */
export function blockThreats(
    options: BlockThreatsOptions = {},
): RequestHandler {
    const status = options.status ?? 403
    const message = options.message ?? 'Access denied.'

    return function blockThreatsMiddleware(request, response, next) {
        const context = requireContext(request, next, 'blockThreats()')

        if (!context) {
            return
        }

        const blocked = context.data?.security
            ? isThreat(context.data, options)
            : options.unknown === 'block'

        if (!blocked) {
            next()
            return
        }

        if (options.response) {
            options.response(context, request, response)
            return
        }

        response.status(status).type('text/plain').send(message)
    }
}

export interface RedirectByCountryOptions {
    /**
     * Maps upper- or lower-case ISO 3166-1 alpha-2 country codes to a
     * destination: either a path ('/fr') resolved against the current origin
     * or an absolute URL ('https://example.de').
     */
    redirects: Record<string, string>

    /**
     * Whether to append the current path and query to the destination, e.g.
     * FR + '/fr' turns '/pricing' into '/fr/pricing'. Defaults to false.
     */
    preservePath?: boolean

    /**
     * The redirect status. Defaults to 307 (temporary) so browsers do not
     * cache a geo decision; use 308 for permanent country domains.
     */
    status?: 307 | 308
}

/**
 * Creates a middleware that redirects visitors to a country-specific path or
 * domain based on `location.country.code`. Never redirects when the visitor
 * is already under the destination (loop-safe). Mount it after
 * `ipregistry()`, whose lookup must include the `location` fields:
 *
 * ```ts
 * app.use(ipregistry({ fields: 'ip,location' }))
 * app.use(redirectByCountry({
 *     redirects: { FR: '/fr', DE: 'https://example.de' },
 *     preservePath: true,
 * }))
 * ```
 */
export function redirectByCountry(
    options: RedirectByCountryOptions,
): RequestHandler {
    for (const [code, destination] of Object.entries(options.redirects)) {
        assertCountryCode(code, 'redirectByCountry()')

        if (!destination.startsWith('/')) {
            try {
                new URL(destination)
            } catch {
                throw new TypeError(
                    `[ipregistry] redirectByCountry() destination ` +
                        `'${destination}' for ${code.toUpperCase()} must ` +
                        "be a path starting with '/' or an absolute URL.",
                )
            }
        }
    }

    const redirects = new Map(
        Object.entries(options.redirects).map(([code, destination]) => [
            code.toUpperCase(),
            destination,
        ]),
    )
    const status = options.status ?? 307

    return function redirectByCountryMiddleware(request, response, next) {
        const context = requireContext(request, next, 'redirectByCountry()')

        if (!context) {
            return
        }

        const code = context.data?.location?.country?.code?.toUpperCase()
        const destination = code ? redirects.get(code) : undefined

        if (!destination) {
            next()
            return
        }

        const host = request.get('host') ?? 'localhost'
        const current = new URL(
            request.originalUrl,
            `${request.protocol}://${host}`,
        )
        const target = destination.startsWith('/')
            ? new URL(destination, current.origin)
            : new URL(destination)

        const targetPath = target.pathname.replace(/\/$/, '')

        const alreadyThere =
            target.host === current.host &&
            (targetPath === '' ||
                current.pathname === targetPath ||
                current.pathname.startsWith(`${targetPath}/`))

        if (alreadyThere) {
            next()
            return
        }

        if (options.preservePath) {
            target.pathname = `${targetPath}${current.pathname}`.replace(
                /\/{2,}/g,
                '/',
            )
            target.search = current.search
        }

        const location =
            target.origin === current.origin
                ? `${target.pathname}${target.search}`
                : target.toString()

        response.redirect(status, location)
    }
}

/**
 * Country codes are validated when the middleware is built, so a typo fails
 * fast at startup instead of silently never matching.
 */
function assertCountryCode(code: string, name: string): void {
    if (!/^[A-Za-z]{2}$/.test(code)) {
        throw new TypeError(
            `[ipregistry] ${name} received '${code}', which is not an ` +
                'ISO 3166-1 alpha-2 country code.',
        )
    }
}

function requireContext(
    request: Request,
    next: NextFunction,
    name: string,
): IpregistryContext | null {
    const context = request.ipregistry

    if (!context) {
        next(
            new Error(
                `[ipregistry] ${name} found no Ipregistry context on the ` +
                    'request. Mount the ipregistry() middleware (or ' +
                    'fakeIpregistry() in tests) before it.',
            ),
        )
        return null
    }

    return context
}
