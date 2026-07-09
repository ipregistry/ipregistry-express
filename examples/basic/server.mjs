/*
 * A minimal Express app using @ipregistry/express.
 *
 * Run with:
 *   IPREGISTRY_API_KEY=YOUR_API_KEY node server.mjs
 *
 * Then try:
 *   curl http://localhost:3000/
 *   curl http://localhost:3000/geo
 */

import express from 'express'
import {
    blockCountries,
    blockThreats,
    ipregistry,
    isEuVisitor,
} from '@ipregistry/express'

const app = express()

// Match your proxy topology so req.ip reflects the real client:
// https://expressjs.com/en/guide/behind-proxies.html
app.set('trust proxy', 1)

app.use(
    ipregistry({
        fields: 'ip,location,security',
        // On localhost your IP is private, so no lookup happens. Use a
        // fixed public IP in development to exercise geo features:
        developmentIp:
            process.env.NODE_ENV !== 'production' ? '66.165.2.7' : undefined,
    }),
)

// Composable guards (both fail open when data is unavailable):
app.use(blockCountries({ countries: ['KP', 'IR'] }))
app.use(blockThreats({ tor: true, vpn: true }))

app.get('/', (req, res) => {
    const { data } = req.ipregistry

    res.send(
        `Hello ${data?.location?.country?.name ?? 'visitor'}!` +
            (isEuVisitor(req.ipregistry) ? ' (GDPR consent required)' : ''),
    )
})

app.get('/geo', (req, res) => {
    const { ip, data, skipped, error } = req.ipregistry

    res.json({
        ip,
        country: data?.location?.country?.code ?? null,
        city: data?.location?.city ?? null,
        skipped: skipped ?? null,
        error: error ?? null,
    })
})

app.listen(3000, () => {
    console.log('Listening on http://localhost:3000')
})
