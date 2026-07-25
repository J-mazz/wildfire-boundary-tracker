# Deployment (Cloudflare Pages)

```bash
npm run build:pages
npm run deploy:pages
```

The production build strips source maps, bundles the WASM artifacts, validates Pages file
limits, scans output for local secret values, and generates `dist/_headers` from
`public/_headers.template` with the configured imagery origin (CSP includes
`wasm-unsafe-eval`).

`.github/workflows/deploy-pages.yml` validates pull requests and deploys pushes to `main`.
Required GitHub configuration:

- Repository secret `CLOUDFLARE_API_TOKEN`, scoped to Account / Cloudflare Pages / Edit
- Repository variable `CLOUDFLARE_ACCOUNT_ID`

## Pages Functions and secrets

`wrangler pages deploy dist` bundles the top-level `functions/` directory as Pages
Functions; these power the live engine (see [Engine](engine.md)). The project needs one
secret for the VIIRS thermal feed:

```bash
wrangler pages secret put FIRMS_MAP_KEY --project-name <project>
```

Without it the site still works: the landing page and catalogs load from NIFC, and each
frame reports that FIRMS is unconfigured.
