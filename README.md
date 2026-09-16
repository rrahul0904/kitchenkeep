# KitchenKeep

KitchenKeep is an independent recipe capture and cooking workflow inspired by the public problem described in the MiamBot SideProject post: recipes get buried in chats/social feeds, recipe pages are noisy while cooking, and meal planning creates a second grocery-list problem.

It recreates the product loop without copying MiamBot code or branding:

**Capture → Extract → Normalize → Save → Plan → Shop → Cook**

## Implemented

### Capture and extraction

- Public recipe webpages using `schema.org/Recipe` JSON-LD
- Readable-text heuristic fallback for recipe pages without structured data
- YouTube description + public caption-track extraction where captions are available
- Best-effort public Instagram/TikTok/webpage fallback through readable page text
- Pasted recipe text
- TXT, Markdown, HTML and JSON file imports
- Digital PDF text extraction, including basic Flate-compressed streams
- Image and scanned/complex PDF extraction through the OpenAI Responses API when `OPENAI_API_KEY` is configured
- Structured provenance (`sourceType`, `extractionMethod`, `confidence`) on imported recipes
- SSRF-aware URL fetch boundary, redirect re-validation, response-size limits and import throttling

### Kitchen workflow

- Recipe library with browser-local persistence
- Search by recipe, ingredient, or tag
- Dynamic serving scaling
- Recipe JSON export and delete
- Cook Mode with step navigation and Screen Wake Lock support
- Weekly meal planner
- Grocery list generated from planned recipes
- Alias-aware ingredient aggregation (for example scallions / spring onions / green onions)
- Grocery check-off persistence
- Responsive desktop/mobile UI
- PWA manifest + offline app-shell service worker

### Release readiness

- `/api/health` health endpoint
- Security headers + restrictive CSP
- Dockerfile
- Railway deployment config with health check
- GitHub Actions CI with syntax, unit/integration tests, boot and HTTP smoke test
- Zero mandatory runtime npm dependencies

## Local run

```bash
npm ci
npm run check
npm start
```

Open `http://localhost:3000`.

## Optional AI media extraction

Images and scanned/complex PDFs use the OpenAI Responses API. The app remains fully functional without an API key for web, YouTube-caption, text, and readable PDF imports.

```bash
export OPENAI_API_KEY="..."
export OPENAI_MODEL="gpt-5.6-luna" # optional override
npm start
```

Never expose the API key in the browser or commit it to GitHub.

## Deploy

The repository is ready for a standard Node/Docker host. Railway can deploy directly from GitHub and uses `railway.json` + `/api/health`.

Required environment variables: none.

Optional production variable:

- `OPENAI_API_KEY` — enables image/scanned-PDF and AI fallback extraction.
- `OPENAI_MODEL` — defaults to `gpt-5.6-luna`.

## Certification

`npm run check` currently covers:

- ingredient alias convergence
- fractional quantity parsing
- grocery aggregation
- schema.org recipe extraction
- plain-text recipe extraction
- HTML fallback extraction
- YouTube player/caption parsing
- PDF text extraction
- API health and text-import integration
- private-network URL blocking

See [`REVERSE_ENGINEERING.md`](./REVERSE_ENGINEERING.md) for the observed-vs-implemented parity boundary.
