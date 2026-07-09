# Basic example

A minimal Express app using `@ipregistry/express`: request enrichment,
country blocking, threat blocking, and GDPR detection.

```sh
npm install
IPREGISTRY_API_KEY=YOUR_API_KEY npm start
```

Then:

```sh
curl http://localhost:3000/
curl http://localhost:3000/geo
```

Without an API key the app still runs: lookups fail open and `/geo` reports
the error on the context.
