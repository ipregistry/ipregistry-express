import { describe, expect, it } from 'vitest'

import { isBot, isEuVisitor, isThreat } from '../src/guards.js'
import { ipInfo } from './fixtures.js'

describe('isEuVisitor', () => {
    it('returns true for EU visitors', () => {
        const info = ipInfo()
        info.location!.in_eu = true

        expect(isEuVisitor(info)).toBe(true)
    })

    it('returns false for non-EU visitors', () => {
        expect(isEuVisitor(ipInfo())).toBe(false)
    })

    it('accepts a context object', () => {
        const info = ipInfo()
        info.location!.in_eu = true

        expect(isEuVisitor({ ip: info.ip, data: info })).toBe(true)
    })

    it('fails open on missing data', () => {
        expect(isEuVisitor(null)).toBe(false)
        expect(isEuVisitor({ ip: null, data: null, skipped: 'no-ip' })).toBe(
            false,
        )
    })

    it('honors assumeEu on missing data', () => {
        expect(isEuVisitor(null, { assumeEu: true })).toBe(true)
        expect(isEuVisitor(ipInfo(), { assumeEu: true })).toBe(false)
    })
})

describe('isThreat', () => {
    it('flags threats, attackers, and abusers by default', () => {
        for (const flag of ['is_threat', 'is_attacker', 'is_abuser']) {
            const info = ipInfo()
            ;(info.security as unknown as Record<string, boolean>)[flag] = true

            expect(isThreat(info)).toBe(true)
        }
    })

    it('ignores anonymization signals by default', () => {
        const info = ipInfo()
        info.security!.is_tor = true
        info.security!.is_vpn = true

        expect(isThreat(info)).toBe(false)
        expect(isThreat(info, { tor: true })).toBe(true)
        expect(isThreat(info, { vpn: true })).toBe(true)
    })

    it('covers tor exits with the tor flag', () => {
        const info = ipInfo()
        info.security!.is_tor_exit = true

        expect(isThreat(info, { tor: true })).toBe(true)
    })

    it('fails open on missing data', () => {
        expect(isThreat(null)).toBe(false)
        expect(isThreat({ ip: null, data: null })).toBe(false)
    })
})

describe('isBot', () => {
    it('detects bot user agents', () => {
        expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true)
        expect(
            isBot(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
                    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 ' +
                    'Safari/537.36',
            ),
        ).toBe(false)
    })

    it('reads the user agent from Express-style headers', () => {
        expect(isBot({ headers: { 'user-agent': 'my-crawler/1.0' } })).toBe(
            true,
        )
    })

    it('fails open on missing input', () => {
        expect(isBot(null)).toBe(false)
        expect(isBot({ headers: {} })).toBe(false)
    })
})
