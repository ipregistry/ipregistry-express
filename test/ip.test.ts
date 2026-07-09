import { describe, expect, it } from 'vitest'
import type { Request } from 'express'

import {
    anonymizeIp,
    createIpExtractor,
    isPrivateIp,
    isValidIp,
    sanitizeIp,
} from '../src/ip.js'

function fakeRequest(overrides: {
    ip?: string
    remoteAddress?: string
    headers?: Record<string, string | string[]>
}): Request {
    return {
        ip: overrides.ip,
        socket: { remoteAddress: overrides.remoteAddress },
        headers: overrides.headers ?? {},
    } as unknown as Request
}

describe('sanitizeIp', () => {
    it('trims whitespace', () => {
        expect(sanitizeIp(' 1.2.3.4 ')).toBe('1.2.3.4')
    })

    it('strips IPv4 port suffixes', () => {
        expect(sanitizeIp('1.2.3.4:8080')).toBe('1.2.3.4')
    })

    it('strips IPv6 brackets and ports', () => {
        expect(sanitizeIp('[2001:db8::1]:443')).toBe('2001:db8::1')
        expect(sanitizeIp('[2001:db8::1]')).toBe('2001:db8::1')
    })

    it('strips zone identifiers', () => {
        expect(sanitizeIp('fe80::1%eth0')).toBe('fe80::1')
    })

    it('unmaps IPv4-mapped IPv6 addresses', () => {
        expect(sanitizeIp('::ffff:203.0.113.9')).toBe('203.0.113.9')
        expect(sanitizeIp('::FFFF:203.0.113.9')).toBe('203.0.113.9')
    })
})

describe('isValidIp', () => {
    it('accepts valid addresses', () => {
        expect(isValidIp('1.2.3.4')).toBe(true)
        expect(isValidIp('255.255.255.255')).toBe(true)
        expect(isValidIp('2001:db8::1')).toBe(true)
        expect(isValidIp('::1')).toBe(true)
        expect(isValidIp('::ffff:1.2.3.4')).toBe(true)
    })

    it('rejects invalid addresses', () => {
        expect(isValidIp('')).toBe(false)
        expect(isValidIp('1.2.3.256')).toBe(false)
        expect(isValidIp('1.2.3')).toBe(false)
        expect(isValidIp('not-an-ip')).toBe(false)
        expect(isValidIp('2001:db8:::1')).toBe(false)
        expect(isValidIp('1.2.3.4; DROP TABLE')).toBe(false)
    })
})

describe('isPrivateIp', () => {
    it('detects private and reserved ranges', () => {
        expect(isPrivateIp('127.0.0.1')).toBe(true)
        expect(isPrivateIp('10.1.2.3')).toBe(true)
        expect(isPrivateIp('172.16.0.1')).toBe(true)
        expect(isPrivateIp('192.168.1.1')).toBe(true)
        expect(isPrivateIp('100.64.0.1')).toBe(true)
        expect(isPrivateIp('169.254.0.1')).toBe(true)
        expect(isPrivateIp('::1')).toBe(true)
        expect(isPrivateIp('fe80::1')).toBe(true)
        expect(isPrivateIp('fd00::1')).toBe(true)
        expect(isPrivateIp('::ffff:192.168.0.1')).toBe(true)
    })

    it('accepts public addresses', () => {
        expect(isPrivateIp('66.165.2.7')).toBe(false)
        expect(isPrivateIp('8.8.8.8')).toBe(false)
        expect(isPrivateIp('2001:db8::1')).toBe(false)
    })
})

describe('anonymizeIp', () => {
    it('zeroes the last IPv4 octet', () => {
        expect(anonymizeIp('66.165.2.7')).toBe('66.165.2.0')
    })

    it('truncates IPv6 addresses', () => {
        expect(anonymizeIp('2001:db8:1234:5678::1')).toBe('2001:db8:1234::')
    })
})

describe('createIpExtractor', () => {
    it("defaults to the 'express' preset reading req.ip", () => {
        const extract = createIpExtractor()

        expect(extract(fakeRequest({ ip: '66.165.2.7' }))).toBe('66.165.2.7')
    })

    it('unmaps IPv4-mapped socket addresses', () => {
        const extract = createIpExtractor('express')

        expect(
            extract(fakeRequest({ remoteAddress: '::ffff:66.165.2.7' })),
        ).toBe('66.165.2.7')
    })

    it('falls back to the socket address when req.ip is unset', () => {
        const extract = createIpExtractor('express')

        expect(extract(fakeRequest({ remoteAddress: '66.165.2.7' }))).toBe(
            '66.165.2.7',
        )
    })

    it('reads cf-connecting-ip for the cloudflare preset', () => {
        const extract = createIpExtractor('cloudflare')

        expect(
            extract(
                fakeRequest({
                    ip: '203.0.113.1',
                    headers: { 'cf-connecting-ip': '66.165.2.7' },
                }),
            ),
        ).toBe('66.165.2.7')
        expect(extract(fakeRequest({ ip: '203.0.113.1' }))).toBe(null)
    })

    it('prefers x-real-ip for the nginx preset', () => {
        const extract = createIpExtractor('nginx')

        expect(
            extract(
                fakeRequest({
                    headers: {
                        'x-real-ip': '66.165.2.7',
                        'x-forwarded-for': '203.0.113.1',
                    },
                }),
            ),
        ).toBe('66.165.2.7')
    })

    it('takes the first entry of x-forwarded-for', () => {
        const extract = createIpExtractor('forwarded-for')

        expect(
            extract(
                fakeRequest({
                    headers: {
                        'x-forwarded-for': '66.165.2.7, 10.0.0.1, 10.0.0.2',
                    },
                }),
            ),
        ).toBe('66.165.2.7')
    })

    it('supports a single custom trusted header', () => {
        const extract = createIpExtractor({ header: 'X-Client-IP' })

        expect(
            extract(fakeRequest({ headers: { 'x-client-ip': '66.165.2.7' } })),
        ).toBe('66.165.2.7')
    })

    it('validates values returned by custom extractors', () => {
        const extract = createIpExtractor(() => 'garbage')

        expect(extract(fakeRequest({}))).toBe(null)
    })

    it('rejects invalid header values', () => {
        const extract = createIpExtractor('forwarded-for')

        expect(
            extract(fakeRequest({ headers: { 'x-forwarded-for': 'spoofed' } })),
        ).toBe(null)
    })
})
