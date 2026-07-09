# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-09

### Added

- Initial release of the official Ipregistry Express integration, built on
  `@ipregistry/client` v7.
- `ipregistry()` middleware (also the default export): enriches requests
  with Ipregistry data as `req.ipregistry` (mirrored on
  `res.locals.ipregistry`), with field selection, in-memory LRU caching,
  coalescing of concurrent lookups for the same IP, static-asset/bot/custom
  skips, `developmentIp`, fail-open by default with optional fail-closed,
  and `onError`/`debug` hooks.
- One-time warning when a private connection IP arrives together with an
  `X-Forwarded-For` header, the classic sign of a reverse proxy without
  `trust proxy` configured.
- `trust proxy`-aware IP extraction via `req.ip` by default, plus
  `cloudflare`, `nginx`, `forwarded-for`, single-header, and custom
  extractor sources. Values are validated and sanitized; private and
  reserved addresses are never sent to the API.
- Composable guard middlewares: `blockCountries` (451, block/allow modes),
  `blockThreats` (403, opt-in proxy/Tor/VPN/relay signals), and
  `redirectByCountry` (loop-safe 307/308 redirects with `preservePath`).
- Helpers: `getIpregistry`, `isEuVisitor` (GDPR), `isThreat`, `isBot`.
- Testing fake: `fakeIpregistry()` attaches canned contexts without HTTP.
- TypeScript-first API with Express `Request`/`Locals` declaration merging,
  dual ESM/CJS build, Express 4.18+ and 5 support, Node.js 20+.

[1.0.0]: https://github.com/ipregistry/ipregistry-express/releases/tag/v1.0.0
