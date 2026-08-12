#!/usr/bin/env bash
# Deploy to Cloudflare Pages: https://scarborough-film-map.pages.dev
# Assembles only the runtime files into dist/ (keeps CLAUDE.md, docs/, schema.sql, tools/ off
# the public site), then direct-uploads with wrangler. Auth: `npx wrangler login` once.
#
# functions/ MUST be copied in: Pages compiles the API from <upload-dir>/functions, so a deploy
# that forgets it serves the app with every /api/* call 404ing.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist
mkdir -p dist/data dist/icons dist/app
# root: public landing page + the PWA plumbing (sw.js stays at root scope so v2
# installs upgrade in place; manifest start_url points into /app/)
cp index.html landing.css sw.js manifest.webmanifest dist/
# the private console app — everything under /app/ (Cloudflare Access will
# protect the /app* path; see docs/access-setup.md)
cp app/index.html app/app.js app/styles.css dist/app/
# public guest page — served at /suggest (Pages resolves the .html extension)
cp suggest.html suggest.js suggest.css dist/
cp data/scarborough.geojson data/scarborough-boundary.geojson data/neighbourhood-blurbs.json dist/data/
cp icons/*.png dist/icons/
cp -R functions dist/functions

npx wrangler pages deploy dist --project-name scarborough-film-map --commit-dirty=true
