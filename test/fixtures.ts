import type { IpInfo, IpregistryClient } from '@ipregistry/client'

export const PUBLIC_IP = '66.165.2.7'

export function ipInfo(overrides: Partial<IpInfo> = {}): IpInfo {
    return {
        ip: PUBLIC_IP,
        type: 'IPV4',
        location: {
            country: { code: 'US', name: 'United States' },
            city: 'Ashburn',
            in_eu: false,
        },
        security: {
            is_abuser: false,
            is_attacker: false,
            is_threat: false,
            is_tor: false,
            is_tor_exit: false,
            is_vpn: false,
            is_proxy: false,
            is_relay: false,
            is_anonymous: false,
            is_cloud_provider: false,
            is_bogon: false,
        },
        ...overrides,
    } as unknown as IpInfo
}

export interface StubClient {
    client: IpregistryClient
    calls: Array<{ ip: string; options?: Record<string, unknown> }>
}

/**
 * A minimal stand-in for the SDK client: records lookup calls and returns
 * canned data (or throws the provided error).
 */
export function stubClient(
    result: IpInfo | Error = ipInfo(),
    perIp?: Record<string, IpInfo>,
): StubClient {
    const calls: StubClient['calls'] = []

    const client = {
        async lookupIp(ip: string, options?: Record<string, unknown>) {
            calls.push({ ip, options })

            if (result instanceof Error) {
                throw result
            }

            return {
                credits: { consumed: 1, remaining: null },
                data: perIp?.[ip] ?? { ...result, ip },
                throttling: null,
            }
        },
    } as unknown as IpregistryClient

    return { client, calls }
}
