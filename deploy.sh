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
mkdir -p dist/data dist/icons
cp index.html app.js styles.css sw.js manifest.webmanifest dist/
# public guest page — served at /suggest (Pages resolves the .html extension)
cp suggest.html suggest.js suggest.css dist/
cp data/scarborough.geojson data/scarborough-boundary.geojson data/neighbourhood-blurbs.json dist/data/
cp icons/*.png dist/icons/
cp -R functions dist/functions

npx wrangler pages deploy dist --project-name scarborough-film-map --commit-dirty=true
