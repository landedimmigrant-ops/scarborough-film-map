#!/usr/bin/env bash
# Local dev server — http://localhost:8138
#
# This replaced `python3 -m http.server` in the Neon migration: the app's data now
# comes from functions/api/[[route]].js, and only Wrangler can run a Pages Function.
# A plain static server still renders the map, but every location read/write 404s.
#
# Serves the repo root (so edits are live on reload — no dist/ rebuild) and mounts:
#   NEON_DATABASE_URL  from .dev.vars   (gitignored; see README)
#   PHOTOS             a LOCAL simulated R2 bucket under .wrangler/state — uploads
#                      you make in dev stay on this machine and never touch the real
#                      bucket, which is what you want while testing.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .dev.vars ]; then
  echo "! .dev.vars is missing. Create it with:" >&2
  echo "    echo 'NEON_DATABASE_URL=\"<your neon connection string>\"' > .dev.vars" >&2
  echo "  (the string is in .neon, or: npx neonctl connection-string --project-id lively-voice-91994065)" >&2
  exit 1
fi

exec npx wrangler pages dev . --port 8138 --r2 PHOTOS "$@"
