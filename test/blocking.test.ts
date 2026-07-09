import express, {
    type NextFunction,
    type Request,
    type Response,
} from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'

import {
    blockCountries,
    blockThreats,
    fakeIpregistry,
    redirectByCountry,
} from '../src/index.js'
import { ipInfo } from './fixtures.js'

function appWith(
    context: Parameters<typeof fakeIpregistry>[0],
    ...handlers: express.RequestHandler[]
) {
    const app = express()
    app.use(fakeIpregistry(context))
    app.use(...handlers)
    app.use((_req: Request, res: Response) => {
        res.send('ok')
    })

    // Swallow expected middleware errors so supertest sees a clean 500.
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
        res.status(500).json({ message: err.message })
    })

    return app
}

function fromCountry(code: string) {
    return {
        location: { country: { code, name: code } },
    }
}

describe('blockCountries', () => {
    it('blocks listed countries with 451', async () => {
        const app = appWith(
            fromCountry('KP'),
            blockCountries({ countries: ['KP', 'IR'] }),
        )

        const response = await request(app).get('/')

        expect(response.status).toBe(451)
        expect(response.text).toBe('Access restricted in your region.')
    })

    it('lets other countries through', async () => {
        const app = appWith(
            fromCountry('FR'),
            blockCountries({ countries: ['KP', 'IR'] }),
        )

        expect((await request(app).get('/')).status).toBe(200)
    })

    it('is case-insensitive', async () => {
        const app = appWith(
            fromCountry('kp'),
            blockCountries({ countries: ['Kp'] }),
        )

        expect((await request(app).get('/')).status).toBe(451)
    })

    it('supports allowlist mode', async () => {
        const app = appWith(
            fromCountry('US'),
            blockCountries({ countries: ['FR'], mode: 'allow' }),
        )

        expect((await request(app).get('/')).status).toBe(451)
    })

    it('fails open when the country is unknown', async () => {
        const app = appWith(
            { ip: null, data: null, skipped: 'no-ip' },
            blockCountries({ countries: ['KP'] }),
        )

        expect((await request(app).get('/')).status).toBe(200)
    })

    it('blocks unknown countries when asked to', async () => {
        const app = appWith(
            { ip: null, data: null, skipped: 'no-ip' },
            blockCountries({ countries: ['KP'], unknown: 'block' }),
        )

        expect((await request(app).get('/')).status).toBe(451)
    })

    it('supports custom status and message', async () => {
        const app = appWith(
            fromCountry('KP'),
            blockCountries({
                countries: ['KP'],
                status: 403,
                message: 'Nope.',
            }),
        )

        const response = await request(app).get('/')

        expect(response.status).toBe(403)
        expect(response.text).toBe('Nope.')
    })

    it('supports a custom responder', async () => {
        const app = appWith(
            fromCountry('KP'),
            blockCountries({
                countries: ['KP'],
                response: (context, _req, res) => {
                    res.status(418).json({ country: 'KP', ip: context.ip })
                },
            }),
        )

        const response = await request(app).get('/')

        expect(response.status).toBe(418)
        expect(response.body.country).toBe('KP')
    })

    it('rejects invalid country codes at setup time', () => {
        expect(() => blockCountries({ countries: ['FRA'] })).toThrow(TypeError)
        expect(() => blockCountries({ countries: ['F'] })).toThrow(TypeError)
        expect(() => blockCountries({ countries: ['fr'] })).not.toThrow()
    })

    it('errors clearly when ipregistry() did not run', async () => {
        const app = express()
        app.use(blockCountries({ countries: ['KP'] }))
        app.get('/', (_req, res) => res.send('ok'))
        app.use(
            (err: Error, _req: Request, res: Response, _next: NextFunction) => {
                res.status(500).json({ message: err.message })
            },
        )

        const response = await request(app).get('/')

        expect(response.status).toBe(500)
        expect(response.body.message).toContain('ipregistry()')
    })
})

describe('blockThreats', () => {
    function withSecurity(flags: Record<string, boolean>) {
        const info = ipInfo()
        Object.assign(info.security as object, flags)
        return info
    }

    it('blocks threats by default with 403', async () => {
        const app = appWith(withSecurity({ is_threat: true }), blockThreats())

        const response = await request(app).get('/')

        expect(response.status).toBe(403)
        expect(response.text).toBe('Access denied.')
    })

    it('lets clean visitors through', async () => {
        const app = appWith(ipInfo(), blockThreats())

        expect((await request(app).get('/')).status).toBe(200)
    })

    it('does not block Tor unless opted in', async () => {
        const tor = withSecurity({ is_tor: true })

        expect(
            (await request(appWith(tor, blockThreats())).get('/')).status,
        ).toBe(200)
        expect(
            (await request(appWith(tor, blockThreats({ tor: true }))).get('/'))
                .status,
        ).toBe(403)
    })

    it('fails open when no security data is available', async () => {
        const app = appWith({ ip: null, data: null }, blockThreats())

        expect((await request(app).get('/')).status).toBe(200)
    })

    it('blocks unknown visitors when asked to', async () => {
        const app = appWith(
            { ip: null, data: null },
            blockThreats({ unknown: 'block' }),
        )

        expect((await request(app).get('/')).status).toBe(403)
    })
})

describe('redirectByCountry', () => {
    const redirect = redirectByCountry({
        redirects: { FR: '/fr', DE: 'https://example.de' },
    })

    it('redirects to a country path with 307', async () => {
        const app = appWith(fromCountry('FR'), redirect)

        const response = await request(app).get('/pricing')

        expect(response.status).toBe(307)
        expect(response.headers.location).toBe('/fr')
    })

    it('redirects to a country domain', async () => {
        const app = appWith(fromCountry('DE'), redirect)

        const response = await request(app).get('/')

        expect(response.status).toBe(307)
        expect(response.headers.location).toBe('https://example.de/')
    })

    it('does not redirect unmapped countries', async () => {
        const app = appWith(fromCountry('US'), redirect)

        expect((await request(app).get('/')).status).toBe(200)
    })

    it('is loop-safe for paths', async () => {
        const app = appWith(fromCountry('FR'), redirect)

        expect((await request(app).get('/fr')).status).toBe(200)
        expect((await request(app).get('/fr/pricing')).status).toBe(200)
    })

    it('preserves the path and query when asked to', async () => {
        const app = appWith(
            fromCountry('FR'),
            redirectByCountry({
                redirects: { FR: '/fr' },
                preservePath: true,
            }),
        )

        const response = await request(app).get('/pricing?plan=pro')

        expect(response.status).toBe(307)
        expect(response.headers.location).toBe('/fr/pricing?plan=pro')
    })

    it('supports 308', async () => {
        const app = appWith(
            fromCountry('FR'),
            redirectByCountry({ redirects: { FR: '/fr' }, status: 308 }),
        )

        expect((await request(app).get('/')).status).toBe(308)
    })

    it('fails open without data', async () => {
        const app = appWith({ ip: null, data: null }, redirect)

        expect((await request(app).get('/')).status).toBe(200)
    })

    it('rejects invalid codes and destinations at setup time', () => {
        expect(() => redirectByCountry({ redirects: { FRA: '/fr' } })).toThrow(
            TypeError,
        )
        expect(() =>
            redirectByCountry({ redirects: { FR: 'not-a-url' } }),
        ).toThrow(TypeError)
        expect(() =>
            redirectByCountry({ redirects: { FR: '/fr' } }),
        ).not.toThrow()
        expect(() =>
            redirectByCountry({ redirects: { DE: 'https://example.de' } }),
        ).not.toThrow()
    })
})

describe('composition', () => {
    it('runs guard middlewares in order after enrichment', async () => {
        const app = appWith(
            fromCountry('FR'),
            blockCountries({ countries: ['KP'] }),
            blockThreats(),
            redirectByCountry({ redirects: { FR: '/fr' } }),
        )

        const response = await request(app).get('/pricing')

        expect(response.status).toBe(307)
        expect(response.headers.location).toBe('/fr')
    })
})
