import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'

import {
    fakeIpregistry,
    FAKE_IP,
    getIpregistry,
    ipregistry,
} from '../src/index.js'
import { stubClient } from './fixtures.js'

describe('fakeIpregistry', () => {
    it('attaches a realistic sample context by default', async () => {
        const app = express()
        app.use(fakeIpregistry())
        app.get('/', (req, res) => res.json(getIpregistry(req)))

        const response = await request(app).get('/')

        expect(response.body.ip).toBe(FAKE_IP)
        expect(response.body.data.location.country.code).toBe('US')
        expect(response.body.data.security.is_threat).toBe(false)
    })

    it('merges partial IpInfo overrides section by section', async () => {
        const app = express()
        app.use(
            fakeIpregistry({
                security: { is_tor: true },
            }),
        )
        app.get('/', (req, res) => res.json(getIpregistry(req)))

        const response = await request(app).get('/')

        expect(response.body.data.security.is_tor).toBe(true)
        expect(response.body.ip).toBe(FAKE_IP)
    })

    it('accepts a full context for skip and error simulation', async () => {
        const app = express()
        app.use(fakeIpregistry({ ip: null, data: null, skipped: 'no-ip' }))
        app.get('/', (req, res) => res.json(getIpregistry(req)))

        const response = await request(app).get('/')

        expect(response.body).toEqual({
            ip: null,
            data: null,
            skipped: 'no-ip',
        })
    })

    it('takes precedence over a mounted ipregistry() middleware', async () => {
        const stub = stubClient()
        const app = express()
        app.set('trust proxy', true)
        app.use(fakeIpregistry())
        app.use(ipregistry({ client: stub.client }))
        app.get('/', (req, res) => res.json(getIpregistry(req)))

        const response = await request(app)
            .get('/')
            .set('X-Forwarded-For', '8.8.8.8')

        expect(response.body.ip).toBe(FAKE_IP)
        expect(stub.calls).toHaveLength(0)
    })
})
