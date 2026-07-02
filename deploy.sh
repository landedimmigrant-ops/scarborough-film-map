#!/usr/bin/env bash
# Deploy to Cloudflare Pages: https://scarborough-film-map.pages.dev
# Assembles only the runtime files into dist/ (keeps CLAUDE.md, docs/, etc. off the public site),
# then direct-uploads with wrangler. Auth: `npx wrangler login` once.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist
mkdir -p dist/data dist/icons
cp index.html app.js styles.css sw.js manifest.webmanifest dist/
cp data/scarborough.geojson data/scarborough-boundary.geojson data/neighbourhood-blurbs.json dist/data/
cp icons/*.png dist/icons/

npx wrangler pages deploy dist --project-name scarborough-film-map --commit-dirty=true
