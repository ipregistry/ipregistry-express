import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

import {
    getIpregistry,
    ipregistry,
    type IpregistryOptions,
} from '../src/index.js'
import { ipInfo, PUBLIC_IP, stubClient, type StubClient } from './fixtures.js'

function createApp(
    options: IpregistryOptions = {},
    stub: StubClient = stubClient(),
) {
    const app = express()
    app.set('trust proxy', true)

    app.use(ipregistry({ client: stub.client, ...options }))

    app.get('/context', (req, res) => {
        res.json(getIpregistry(req))
    })

    app.get('/locals', (req, res) => {
        res.json(res.locals.ipregistry ?? null)
    })

    app.get('/styles.css', (req, res) => {
        res.json(getIpregistry(req))
    })

    return { app, stub }
}

describe('ipregistry middleware', () => {
    it('attaches the lookup result to req.ipregistry', async () => {
        const { app, stub } = createApp()

        const response = await request(app)
            .get('/context')
            .set('X-Forwarded-For', PUBLIC_IP)

        expect(response.status).toBe(200)
        expect(response.body.ip).toBe(PUBLIC_IP)
        expect(response.body.data.location.country.code).toBe('US')
        expect(stub.calls).toHaveLength(1)
        expect(stub.calls[0]?.ip).toBe(PUBLIC_IP)
    })

    it('mirrors the context on res.locals', async () => {
        const { app } = createApp()

        const response = await request(app)
            .get('/locals')
            .set('X-Forwarded-For', PUBLIC_IP)

        expect(response.body.ip).toBe(PUBLIC_IP)
    })

    it('passes fields and hostname to the lookup', async () => {
        const { app, stub } = createApp({
            fields: 'ip,location',
            hostname: true,
        })

        await request(app).get('/context').set('X-Forwarded-For', PUBLIC_IP)

        expect(stub.calls[0]?.options).toEqual({
            fields: 'ip,location',
            hostname: true,
        })
    })

    it('skips lookups for private client IPs', async () => {
        const { app, stub } = createApp()

        // No X-Forwarded-For: supertest connects from 127.0.0.1.
        const response = await request(app).get('/context')

        expect(response.body).toEqual({
            ip: null,
            data: null,
            skipped: 'no-ip',
        })
        expect(stub.calls).toHaveLength(0)
    })

    it('uses developmentIp when the client IP is private', async () => {
        const { app, stub } = createApp({ developmentIp: '8.8.8.8' })

        const response = await request(app).get('/context')

        expect(response.body.ip).toBe('8.8.8.8')
        expect(stub.calls[0]?.ip).toBe('8.8.8.8')
    })

    it('rejects an invalid developmentIp at setup time', () => {
        expect(() => ipregistry({ developmentIp: 'nope' })).toThrow(TypeError)
    })

    it('skips static asset paths by default', async () => {
        const { app, stub } = createApp()

        const response = await request(app)
            .get('/styles.css')
            .set('X-Forwarded-For', PUBLIC_IP)

        expect(response.body.skipped).toBe('static-asset')
        expect(stub.calls).toHaveLength(0)
    })

    it('enriches static assets when skipStaticAssets is false', async () => {
        const { app, stub } = createApp({ skipStaticAssets: false })

        await request(app).get('/styles.css').set('X-Forwarded-For', PUBLIC_IP)

        expect(stub.calls).toHaveLength(1)
    })

    it('skips bots when skipBots is enabled', async () => {
        const { app, stub } = createApp({ skipBots: true })

        const response = await request(app)
            .get('/context')
            .set('X-Forwarded-For', PUBLIC_IP)
            .set('User-Agent', 'Mozilla/5.0 (compatible; Googlebot/2.1)')

        expect(response.body.skipped).toBe('bot')
        expect(stub.calls).toHaveLength(0)
    })

    it('supports a custom bot pattern', async () => {
        const { app, stub } = createApp({ skipBots: /my-monitoring/i })

        const response = await request(app)
            .get('/context')
            .set('X-Forwarded-For', PUBLIC_IP)
            .set('User-Agent', 'my-monitoring/2.0')

        expect(response.body.skipped).toBe('bot')
        expect(stub.calls).toHaveLength(0)
    })

    it('supports a custom skip predicate', async () => {
        const { app, stub } = createApp({
            skip: (req) => req.path.startsWith('/context'),
        })

        const response = await request(app)
            .get('/context')
            .set('X-Forwarded-For', PUBLIC_IP)

        expect(response.body.skipped).toBe('custom')
        expect(stub.calls).toHaveLength(0)
    })

    it('supports custom ipSource headers', async () => {
        const { app, stub } = createApp({ ipSource: { header: 'x-client-ip' } })

        const response = await request(app)
            .get('/context')
            .set('X-Client-IP', '8.8.8.8')

        expect(response.body.ip).toBe('8.8.8.8')
        expect(stub.calls[0]?.ip).toBe('8.8.8.8')
    })

    it('fails open on lookup errors', async () => {
        const onError = vi.fn()
        const { app } = createApp({ onError }, stubClient(new Error('boom')))

        const response = await request(app)
            .get('/context')
            .set('X-Forwarded-For', PUBLIC_IP)

        expect(response.status).toBe(200)
        expect(response.body.ip).toBe(PUBLIC_IP)
        expect(response.body.data).toBe(null)
        expect(response.body.error).toEqual({
            code: 'CLIENT_ERROR',
            message: 'boom',
        })
        expect(onError).toHaveBeenCalledOnce()
    })

    it('fails open when no API key is configured', async () => {
        const previous = process.env.IPREGISTRY_API_KEY
        delete process.env.IPREGISTRY_API_KEY

        try {
            const app = express()
            app.set('trust proxy', true)
            app.use(ipregistry())
            app.get('/context', (req, res) => res.json(getIpregistry(req)))

            const response = await request(app)
                .get('/context')
                .set('X-Forwarded-For', PUBLIC_IP)

            expect(response.status).toBe(200)
            expect(response.body.error.code).toBe('MISSING_API_KEY')
        } finally {
            if (previous !== undefined) {
                process.env.IPREGISTRY_API_KEY = previous
            }
        }
    })

    it('responds 503 when failClosed is set', async () => {
        const { app } = createApp(
            { failClosed: true },
            stubClient(new Error('boom')),
        )

        const response = await request(app)
            .get('/context')
            .set('X-Forwarded-For', PUBLIC_IP)

        expect(response.status).toBe(503)
    })

    it('supports a custom failClosed status', async () => {
        const { app } = createApp(
            { failClosed: 403 },
            stubClient(new Error('boom')),
        )

        const response = await request(app)
            .get('/context')
            .set('X-Forwarded-For', PUBLIC_IP)

        expect(response.status).toBe(403)
    })

    it('survives a throwing onError callback', async () => {
        const { app } = createApp(
            {
                onError: () => {
                    throw new Error('handler bug')
                },
            },
            stubClient(new Error('boom')),
        )

        const response = await request(app)
            .get('/context')
            .set('X-Forwarded-For', PUBLIC_IP)

        expect(response.status).toBe(200)
    })

    it('leaves an existing context untouched', async () => {
        const stub = stubClient()
        const app = express()
        app.set('trust proxy', true)

        app.use((req, _res, next) => {
            req.ipregistry = { ip: '8.8.8.8', data: ipInfo() }
            next()
        })
        app.use(ipregistry({ client: stub.client }))
        app.get('/context', (req, res) => res.json(getIpregistry(req)))

        const response = await request(app)
            .get('/context')
            .set('X-Forwarded-For', PUBLIC_IP)

        expect(response.body.ip).toBe('8.8.8.8')
        expect(stub.calls).toHaveLength(0)
    })

    it('returns a no-middleware context when the middleware did not run', () => {
        expect(getIpregistry({})).toEqual({
            ip: null,
            data: null,
            skipped: 'no-middleware',
        })
    })

    it('reports lookup telemetry through onLookup', async () => {
        const onLookup = vi.fn()
        const { app } = createApp({ onLookup })

        await request(app).get('/context').set('X-Forwarded-For', PUBLIC_IP)

        expect(onLookup).toHaveBeenCalledOnce()
        const info = onLookup.mock.calls[0]?.[0]
        expect(info.ip).toBe(PUBLIC_IP)
        expect(info.coalesced).toBe(false)
        expect(info.credits).toEqual({ consumed: 1, remaining: null })
        expect(typeof info.latencyMs).toBe('number')
    })

    it('survives a throwing onLookup hook', async () => {
        const { app } = createApp({
            onLookup: () => {
                throw new Error('metrics bug')
            },
        })

        const response = await request(app)
            .get('/context')
            .set('X-Forwarded-For', PUBLIC_IP)

        expect(response.status).toBe(200)
        expect(response.body.data).toBeTruthy()
    })

    it('coalesces concurrent lookups for the same IP', async () => {
        const calls: string[] = []
        const client = {
            async lookupIp(ip: string) {
                calls.push(ip)
                await new Promise((resolve) => setTimeout(resolve, 25))
                return {
                    credits: { consumed: 1, remaining: null },
                    data: ipInfo(),
                    throttling: null,
                }
            },
        } as never

        const app = express()
        app.set('trust proxy', true)
        app.use(ipregistry({ client }))
        app.get('/context', (req, res) => res.json(getIpregistry(req)))

        const responses = await Promise.all([
            request(app).get('/context').set('X-Forwarded-For', PUBLIC_IP),
            request(app).get('/context').set('X-Forwarded-For', PUBLIC_IP),
            request(app).get('/context').set('X-Forwarded-For', '8.8.8.8'),
        ])

        for (const response of responses) {
            expect(response.status).toBe(200)
            expect(response.body.data).toBeTruthy()
        }

        // Two distinct IPs, three requests: only two API calls.
        expect(calls.sort()).toEqual(['8.8.8.8', PUBLIC_IP].sort())
    })

    it('warns once when X-Forwarded-For is present but trust proxy is off', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        try {
            const stub = stubClient()
            const app = express() // trust proxy intentionally not set
            app.use(ipregistry({ client: stub.client }))
            app.get('/context', (req, res) => res.json(getIpregistry(req)))

            const first = await request(app)
                .get('/context')
                .set('X-Forwarded-For', PUBLIC_IP)
            await request(app).get('/context').set('X-Forwarded-For', PUBLIC_IP)

            // req.ip is the loopback socket address, so the lookup is
            // skipped and the misconfiguration warning fires exactly once.
            expect(first.body.skipped).toBe('no-ip')
            expect(stub.calls).toHaveLength(0)

            const trustProxyWarnings = warn.mock.calls.filter((call) =>
                String(call[0]).includes('trust proxy'),
            )
            expect(trustProxyWarnings).toHaveLength(1)
        } finally {
            warn.mockRestore()
        }
    })
})
