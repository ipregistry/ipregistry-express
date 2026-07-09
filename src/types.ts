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

import type { IpInfo } from '@ipregistry/client'

/**
 * Why the middleware did not perform a lookup for a request.
 *
 * - `static-asset`: the path looked like a static asset (see
 *   `skipStaticAssets`).
 * - `bot`: the user agent matched the bot filter (see `skipBots`).
 * - `custom`: the `skip` callback returned true.
 * - `no-ip`: no valid, public client IP address could be extracted from the
 *   request.
 * - `no-middleware`: `getIpregistry` found no Ipregistry data on the request,
 *   which means the `ipregistry()` middleware did not run for it.
 */
export type IpregistrySkipReason =
    'static-asset' | 'bot' | 'custom' | 'no-ip' | 'no-middleware'

/**
 * A safe, serializable description of a lookup failure.
 */
export interface IpregistryErrorInfo {
    /**
     * The Ipregistry API error code (e.g. 'INVALID_API_KEY') when the failure
     * came from the API, or a client-side code such as 'MISSING_API_KEY' or
     * 'CLIENT_ERROR'.
     */
    code?: string

    message: string
}

/**
 * The Ipregistry context attached to a request by the `ipregistry()`
 * middleware as `req.ipregistry` (and mirrored on `res.locals.ipregistry`
 * for view engines).
 */
export interface IpregistryContext {
    /**
     * The client IP address the lookup was performed for, or null when no
     * valid public IP could be extracted.
     */
    ip: string | null

    /**
     * The Ipregistry data for the client IP, or null when the lookup was
     * skipped or failed. Fields not selected via the `fields` option are
     * absent from the payload even though the `IpInfo` type declares them.
     */
    data: IpInfo | null

    /**
     * Set when the middleware deliberately skipped the lookup.
     */
    skipped?: IpregistrySkipReason

    /**
     * Set when the lookup was attempted but failed. With the default
     * fail-open behavior the request still went through.
     */
    error?: IpregistryErrorInfo
}

/**
 * An `IpregistryContext` that is guaranteed to hold lookup data.
 */
export interface IpregistryLookupContext extends IpregistryContext {
    ip: string
    data: IpInfo
}

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            /**
             * The Ipregistry context attached by the `ipregistry()`
             * middleware (or by `fakeIpregistry()` in tests). Undefined when
             * neither ran for this request.
             */
            ipregistry?: IpregistryContext
        }

        interface Locals {
            /**
             * The Ipregistry context, mirrored from `req.ipregistry` so view
             * engines can read it without extra wiring.
             */
            ipregistry?: IpregistryContext
        }
    }
}

const NO_MIDDLEWARE: IpregistryContext = {
    ip: null,
    data: null,
    skipped: 'no-middleware',
}

/**
 * Reads the Ipregistry context from a request, whether or not the
 * `ipregistry()` middleware ran. Never throws, never triggers an API call.
 *
 * This is a typed convenience over reading `req.ipregistry` directly: when
 * the middleware did not run for the request it returns a context with
 * `data: null` and `skipped: 'no-middleware'` instead of undefined.
 */
export function getIpregistry(request: {
    ipregistry?: IpregistryContext
}): IpregistryContext {
    return request.ipregistry ?? { ...NO_MIDDLEWARE }
}
