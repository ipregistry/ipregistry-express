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

import type { RequestHandler } from 'express'
import type { IpInfo } from '@ipregistry/client'

import type { IpregistryContext } from './types.js'

/**
 * The sample IP address used by `fakeIpregistry` when none is provided.
 */
export const FAKE_IP = '66.165.2.7'

/**
 * A recursively partial `IpInfo`, so tests only specify the fields they
 * care about.
 */
export type PartialIpInfo = {
    [K in keyof IpInfo]?: IpInfo[K] extends object | undefined
        ? PartialDeep<IpInfo[K]>
        : IpInfo[K]
}

type PartialDeep<T> = {
    [K in keyof T]?: T[K] extends object | undefined ? PartialDeep<T[K]> : T[K]
}

function sampleIpInfo(): IpInfo {
    return {
        ip: FAKE_IP,
        type: 'IPV4',
        location: {
            continent: { code: 'NA', name: 'North America' },
            country: {
                code: 'US',
                name: 'United States',
                calling_code: '1',
                tld: '.us',
            },
            region: { code: 'US-VA', name: 'Virginia' },
            city: 'Ashburn',
            in_eu: false,
            latitude: 39.0437,
            longitude: -77.4875,
        },
        security: {
            is_abuser: false,
            is_anonymous: false,
            is_attacker: false,
            is_bogon: false,
            is_cloud_provider: false,
            is_proxy: false,
            is_relay: false,
            is_threat: false,
            is_tor: false,
            is_tor_exit: false,
            is_vpn: false,
        },
    } as unknown as IpInfo
}

/**
 * Creates a middleware that attaches a canned Ipregistry context to every
 * request — no HTTP, no API key, no credits. Use it in tests in place of
 * `ipregistry()`; the real middleware leaves requests that already carry a
 * context untouched, so it can even stay mounted:
 *
 * ```ts
 * // Simulate a French visitor:
 * app.use(fakeIpregistry({ location: { country: { code: 'FR', name: 'France' } } }))
 *
 * // Simulate a Tor exit node:
 * app.use(fakeIpregistry({ security: { is_tor: true } }))
 *
 * // Simulate a skipped or failed lookup by passing a full context:
 * app.use(fakeIpregistry({ ip: null, data: null, skipped: 'no-ip' }))
 * ```
 *
 * A partial `IpInfo` is merged section by section (top-level keys replace
 * the sample's) into a realistic US-based sample. Passing a full
 * `IpregistryContext` (recognized by its `data` key) uses it verbatim.
 */
export function fakeIpregistry(
    dataOrContext?: PartialIpInfo | IpregistryContext,
): RequestHandler {
    const context = resolveContext(dataOrContext)

    return function fakeIpregistryMiddleware(request, response, next) {
        request.ipregistry = context
        response.locals.ipregistry = context
        next()
    }
}

function resolveContext(
    dataOrContext?: PartialIpInfo | IpregistryContext,
): IpregistryContext {
    if (!dataOrContext) {
        return { ip: FAKE_IP, data: sampleIpInfo() }
    }

    if ('data' in dataOrContext) {
        return dataOrContext as IpregistryContext
    }

    const data = {
        ...sampleIpInfo(),
        ...dataOrContext,
    } as unknown as IpInfo

    return { ip: data.ip ?? FAKE_IP, data }
}
