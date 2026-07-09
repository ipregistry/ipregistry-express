[<img src="https://cdn.ipregistry.co/icons/favicon-96x96.png" alt="Ipregistry" width="64"/>](https://ipregistry.co/)

# Ipregistry Express Library

[![License](http://img.shields.io/:license-apache-blue.svg)](LICENSE.txt)
[![Actions Status](https://github.com/ipregistry/ipregistry-express/workflows/CI/badge.svg)](https://github.com/ipregistry/ipregistry-express/actions)
[![npm](https://img.shields.io/npm/v/@ipregistry/express.svg)](https://www.npmjs.com/package/@ipregistry/express)

This is the official Express integration for the [Ipregistry](https://ipregistry.co) IP geolocation and threat data API. It is built on top of the official [`@ipregistry/client`](https://github.com/ipregistry/ipregistry-javascript) JavaScript SDK and makes it feel native to Express: one middleware that enriches `req`, composable geo-blocking and threat-blocking middlewares, `trust proxy`-aware IP extraction, built-in caching, and a first-class testing fake.

```js
app.use(ipregistry({ fields: 'ip,location,security' }))

app.get('/', (req, res) => {
    res.send(
        `Hello ${req.ipregistry?.data?.location?.country?.name ?? 'visitor'}!`,
    )
})
```

## Features

- **One middleware, data everywhere**: a single lookup per request attached as `req.ipregistry` (and `res.locals.ipregistry` for view engines), available to every later handler.
- **Idiomatic composition**: `blockCountries`, `blockThreats`, and `redirectByCountry` are plain Express middlewares — mount them globally, per router, or per route.
- **Trust-proxy aware**: the client IP comes from `req.ip` by default, so your existing `app.set('trust proxy', ...)` configuration keeps working. Cloudflare and Nginx presets included.
- **Built-in caching** through the SDK's LRU cache, so repeated visits from the same IP do not consume additional credits. Plug Redis/Valkey with one interface.
- **GDPR helper** (`isEuVisitor`) based on the API's `location.in_eu` field.
- **Safe by default**: fails open when Ipregistry is unreachable, skips static assets and private IPs, never logs full IP addresses, and never breaks your request pipeline.
- **Testable**: `fakeIpregistry()` swaps in canned responses. No HTTP, no API key, no credits.
- **TypeScript-first**: `req.ipregistry` is typed via declaration merging; the official SDK's response types are re-exported. Works with Express 4 and 5, ESM and CommonJS.

## Getting started

You need an Ipregistry API key. Sign up at [https://ipregistry.co](https://ipregistry.co) to get one along with free lookups.

### Requirements

- Express 4.18 or newer (Express 5 supported)
- Node.js 20 or newer

### Installation

```sh
npm install @ipregistry/express
```

### Setup in three steps

Step 1: configure your API key:

```sh
# .env
IPREGISTRY_API_KEY=YOUR_API_KEY
```

Step 2: mount the middleware. If your app runs behind a reverse proxy or load balancer (almost always in production), configure [`trust proxy`](https://expressjs.com/en/guide/behind-proxies.html) so `req.ip` reflects the real client:

```js
import express from 'express'
import { ipregistry } from '@ipregistry/express'

const app = express()
app.set('trust proxy', 1) // match your proxy topology

app.use(
    ipregistry({
        fields: 'ip,location,security', // fetch only what you need
    }),
)
```

The default export is the same factory, so `import ipregistry from '@ipregistry/express'` works too.

Step 3: read the data anywhere after the middleware:

```js
app.get('/', (req, res) => {
    const { data } = req.ipregistry

    res.json({
        country: data?.location?.country?.code ?? null,
        city: data?.location?.city ?? null,
    })
})
```

In views, the context is mirrored on `res.locals.ipregistry`, so template engines can read it without extra wiring.

The middleware never throws and never triggers more than one API call per request. `req.ipregistry` is an `IpregistryContext`:

```ts
interface IpregistryContext {
    ip: string | null // the visitor IP the lookup ran for
    data: IpInfo | null // the official SDK's IpInfo type
    skipped?: 'static-asset' | 'bot' | 'custom' | 'no-ip' | 'no-middleware'
    error?: { code?: string; message: string }
}
```

TypeScript users get `req.ipregistry` typed automatically through declaration merging. The `getIpregistry(req)` helper is equivalent but returns a `skipped: 'no-middleware'` context instead of undefined when the middleware did not run.

## Configuration

Everything is optional. Explicit options take precedence over environment variables.

| Option             | Environment variable  | Default          | Description                                                                                   |
| ------------------ | --------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `apiKey`           | `IPREGISTRY_API_KEY`  | None             | Your Ipregistry API key.                                                                      |
| `baseUrl`          | `IPREGISTRY_BASE_URL` | default endpoint | API base URL; `'eu'` selects the EU endpoint.                                                 |
| `cache`            | None                  | `InMemoryCache`  | Any SDK `IpregistryCache`, or `false` to disable.                                             |
| `client`           | None                  | None             | A pre-configured `IpregistryClient` (advanced/testing).                                       |
| `debug`            | None                  | `false`          | Log skips and failures with anonymized IPs.                                                   |
| `developmentIp`    | None                  | None             | Fixed IP used when the client IP is private (localhost).                                      |
| `failClosed`       | None                  | `false`          | Respond 503 (or a custom status) when the lookup fails.                                       |
| `fields`           | `IPREGISTRY_FIELDS`   | full response    | Comma-separated field selection, e.g. `'ip,location,security'`.                               |
| `hostname`         | None                  | `false`          | Resolve the hostname of the client IP.                                                        |
| `ipSource`         | None                  | `'express'`      | Where to read the client IP from (see below).                                                 |
| `maxRetries`       | None                  | `0`              | Automatic retries. Off by default because retrying on the request path would stall responses. |
| `onError`          | None                  | None             | Callback for lookup failures (monitoring).                                                    |
| `onLookup`         | None                  | None             | Callback after each successful lookup with latency, credit, and throttling telemetry.         |
| `skip`             | None                  | None             | Custom predicate to skip a request.                                                           |
| `skipBots`         | None                  | `false`          | Skip crawlers: `true` (SDK heuristic) or a custom `RegExp`.                                   |
| `skipStaticAssets` | None                  | `true`           | Skip favicon and common asset extensions.                                                     |
| `timeout`          | `IPREGISTRY_TIMEOUT`  | `3000`           | Lookup timeout in milliseconds.                                                               |

> Tip: set `fields` to fetch only what you use, keeping lookups fast. `'ip,location,security'` covers geo features, blocking, and GDPR detection.

## Blocking countries

```js
import { blockCountries, ipregistry } from '@ipregistry/express'

app.use(ipregistry({ fields: 'ip,location' }))
app.use(blockCountries({ countries: ['KP', 'IR'] })) // 451 by default
```

Options: `mode: 'allow'` turns the list into an allowlist, `unknown: 'block'` also blocks visitors whose country could not be determined (the default is fail-open), `status` and `message` customize the plain-text response, and `response` gives you full control:

```js
blockCountries({
    countries: ['KP', 'IR'],
    response: (context, req, res) => {
        res.status(451).render('blocked', {
            country: context.data?.location?.country?.name,
        })
    },
})
```

Country codes and redirect destinations are validated when the middleware is built, so a typo fails fast at startup instead of silently never matching.

Like any Express middleware, blocking can be scoped to a router or a single route:

```js
app.use('/checkout', blockCountries({ countries: ['US'], mode: 'allow' }))
```

## Blocking proxies, Tor, and threats

```js
import { blockThreats, ipregistry } from '@ipregistry/express'

app.use(ipregistry({ fields: 'ip,security' }))

// Blocks security.is_threat / is_attacker / is_abuser by default.
// Anonymization signals are opt-in:
app.use(blockThreats({ proxy: true, tor: true, vpn: true }))
```

Each flag maps to the same-named `security.is_*` field of the Ipregistry response (`tor` also covers `is_tor_exit`; `relay`, `anonymous`, `cloudProvider`, and `bogon` are also available). Ad-hoc decisions stay plain Express:

```js
import { isThreat } from '@ipregistry/express'

app.post('/checkout', (req, res, next) => {
    if (isThreat(req.ipregistry, { tor: true })) {
        return res.status(403).send('Not available over Tor.')
    }
    next()
})
```

## Country-based redirects

```js
import { ipregistry, redirectByCountry } from '@ipregistry/express'

app.use(ipregistry({ fields: 'ip,location' }))
app.use(
    redirectByCountry({
        redirects: {
            FR: '/fr', // path on the same origin
            DE: 'https://example.de', // or a country domain
        },
        preservePath: true, // /pricing -> /fr/pricing
    }),
)
```

Redirects are loop-safe: a visitor already under `/fr` (or already on `example.de`) is not redirected again. The default status is 307. Pass `status: 308` for permanent redirects.

## GDPR and EU detection

```js
import { isEuVisitor } from '@ipregistry/express'

app.get('/', (req, res) => {
    res.render('home', {
        showCookieConsent: isEuVisitor(req.ipregistry),
    })
})
```

`isEuVisitor` uses the API's `location.in_eu` field. When the data is missing it returns `false`. Pass `{ assumeEu: true }` to default to showing consent UIs instead.

## Caching

Lookups are cached by default with the SDK's `InMemoryCache` (LRU, 2048 entries, 10-minute expiry), scoped to the process. Repeated requests from the same IP consume a single credit until expiry, and concurrent requests from the same IP are coalesced into a single API call, so a burst of parallel requests from one client also consumes a single credit. Plug any store by implementing the SDK's `IpregistryCache` interface:

```js
import { InMemoryCache } from '@ipregistry/client'

// Bigger cache with a 1-hour expiry:
app.use(ipregistry({ cache: new InMemoryCache(16384, 3_600_000) }))

// Or your own (Redis, Valkey, ...):
class MyCache {
    /* get/put/invalidate/invalidateAll */
}
app.use(ipregistry({ cache: new MyCache() }))

// Or disable caching entirely:
app.use(ipregistry({ cache: false }))
```

## IP extraction behind proxies

By default the middleware reads `req.ip`, which Express computes from the socket address and the `X-Forwarded-For` header according to your [`trust proxy`](https://expressjs.com/en/guide/behind-proxies.html) setting. Configure `trust proxy` correctly and the default does the right thing:

```js
app.set('trust proxy', 1) // one proxy in front (nginx, ALB, ...)
app.set('trust proxy', 'loopback') // or a trust specification
```

Alternatively, read a specific trusted header. Only trust headers your platform actually overwrites, otherwise clients can spoof their IP:

```js
// Cloudflare (only trusts cf-connecting-ip)
app.use(ipregistry({ ipSource: 'cloudflare' }))

// Nginx with `proxy_set_header X-Real-IP $remote_addr;`
app.use(ipregistry({ ipSource: 'nginx' }))

// A single custom trusted header
app.use(ipregistry({ ipSource: { header: 'x-client-ip' } }))

// Full control
app.use(ipregistry({ ipSource: (req) => req.headers['x-my-edge-ip'] ?? null }))
```

Extracted values are validated; ports, IPv6 brackets, IPv4-mapped prefixes, and zone IDs are stripped; private and reserved addresses are never sent to the API.

If the middleware sees a private connection IP together with an `X-Forwarded-For` header — the classic sign of a reverse proxy without `trust proxy` configured — it logs a one-time warning pointing at this section instead of silently skipping every lookup.

On localhost your IP is private, so no lookup happens. To exercise geo features in development:

```js
app.use(
    ipregistry({
        developmentIp:
            process.env.NODE_ENV !== 'production' ? '66.165.2.7' : undefined,
    }),
)
```

## Saving credits on bots and static assets

Static assets (favicon, images, fonts, and similar extensions) are skipped by default. Search bots are skipped opt-in:

```js
app.use(
    ipregistry({
        skipBots: true, // SDK heuristic (bot, crawl, spider, slurp)
        // or a custom pattern:
        skipBots: /googlebot|bingbot|my-monitoring/i,
        // and any custom rule:
        skip: (req) => req.path.startsWith('/healthz'),
    }),
)
```

Mount order remains your primary filter: anything handled before the middleware (`express.static`, health checks) never triggers a lookup.

## Error handling

The middleware fails open by default. If Ipregistry is unreachable, the request times out, the API key is missing or invalid, or the response is malformed, the request continues normally with `data: null` and an `error` on the context. Users are never blocked by an outage, no exception ever escapes into your request pipeline, and full IP addresses are never logged.

```js
app.get('/geo', (req, res) => {
    if (req.ipregistry.error) {
        // e.g. { code: 'INVALID_API_KEY', message: '...' }
        // codes: Ipregistry API codes, plus MISSING_API_KEY / CLIENT_ERROR
    }
})
```

For security-sensitive apps that must not serve traffic without IP intelligence, opt into fail-closed:

```js
app.use(
    ipregistry({
        failClosed: true, // 503 on lookup failure
        // failClosed: 403,      // or pick the status
        onError: (error) => reportToMonitoring(error),
    }),
)
```

The blocking middlewares fail open independently: when the lookup was skipped or failed, `blockCountries` and `blockThreats` let the request through unless you pass `unknown: 'block'`.

## Monitoring

The `onLookup` hook fires after every successful lookup with latency, credit, and throttling telemetry — cache hits report zero consumed credits, so it doubles as a cache-hit-ratio signal:

```js
app.use(
    ipregistry({
        onLookup: ({ latencyMs, credits, coalesced }) => {
            metrics.timing('ipregistry.lookup', latencyMs)
            metrics.increment('ipregistry.credits', credits.consumed ?? 0)
            if (coalesced) metrics.increment('ipregistry.coalesced')
        },
        onError: (error) => reportToMonitoring(error),
    }),
)
```

Exceptions thrown by the hooks are swallowed: monitoring code can never break request handling.

## Testing your app

`fakeIpregistry()` attaches a canned context — no HTTP, no API key, no credits. The real middleware leaves requests that already carry a context untouched, so the fake can be mounted in front of your app as-is:

```js
import request from 'supertest'
import { fakeIpregistry } from '@ipregistry/express'

// Simulate a French visitor:
app.use(
    fakeIpregistry({ location: { country: { code: 'FR', name: 'France' } } }),
)

// Simulate a Tor exit node:
app.use(fakeIpregistry({ security: { is_tor: true } }))

// Simulate a skipped lookup (e.g. localhost):
app.use(fakeIpregistry({ ip: null, data: null, skipped: 'no-ip' }))
```

Partial `IpInfo` values are merged into a realistic US-based sample; passing a full context (recognized by its `data` key) uses it verbatim.

## API reference

| Export                            | Description                                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `blockCountries(options)`         | Middleware that blocks (or exclusively allows) visitors by ISO 3166-1 country code.                                                           |
| `blockThreats(options)`           | Middleware that blocks visitors flagged by Ipregistry security data.                                                                          |
| `createIpExtractor(source)`       | Builds an IP extractor from an `IpSource` (presets, header, or function).                                                                     |
| `createIpregistryClient(options)` | Builds the underlying SDK client from options and environment variables.                                                                      |
| `fakeIpregistry(data?)`           | Testing middleware that attaches a canned context.                                                                                            |
| `getIpregistry(req)`              | Reads the request's context; returns a `skipped: 'no-middleware'` context when the middleware did not run. Never throws, never calls the API. |
| `ipregistry(options)`             | The enrichment middleware (also the default export). Attaches `req.ipregistry` and `res.locals.ipregistry`.                                   |
| `isBot(input)`                    | True for bot user agents. Accepts a user agent string, a request, or a parsed SDK `UserAgent`.                                                |
| `isEuVisitor(input, options?)`    | True when the visitor is in the European Union, based on `location.in_eu`. Accepts an `IpInfo` or an `IpregistryContext`.                     |
| `isThreat(input, options?)`       | True when the IP is flagged by `security.is_threat`, `is_attacker`, or `is_abuser`. Proxy, Tor, VPN, and relay signals are opt-in.            |
| `redirectByCountry(options)`      | Middleware that redirects visitors to country-specific paths or domains, loop-safe.                                                           |

Types: `BlockCountriesOptions`, `BlockThreatsOptions`, `IpExtractor`, `IpregistryContext`, `IpregistryErrorInfo`, `IpregistryLookupContext`, `IpregistryLookupInfo`, `IpregistryOptions`, `IpregistrySkipReason`, `IpSource`, `RedirectByCountryOptions`, `ThreatOptions`, `TrustedProxyPreset`, plus the SDK's `Carrier`, `Company`, `Connection`, `Currency`, `IpInfo`, `Location`, `Security`, `TimeZone`, and `UserAgent`.

## Using the SDK directly

For batch lookups, ASN lookups, user-agent parsing, and background jobs, use the [`@ipregistry/client`](https://github.com/ipregistry/ipregistry-javascript) SDK directly — it is a dependency of this package, so it is already installed. This package removes the client wiring, IP extraction, caching, and error-handling boilerplate from your Express request handling.

## Examples

A complete minimal setup lives in [`examples/basic`](./examples/basic).

## Other resources

- [API documentation](https://ipregistry.co/docs)
- [Issue tracker](https://github.com/ipregistry/ipregistry-express/issues)
- Email: support@ipregistry.co

## License

Apache License 2.0. See [LICENSE.txt](./LICENSE.txt).
