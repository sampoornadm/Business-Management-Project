#!/usr/bin/env bash
# DEV/TEST ONLY. A second web instance that skips the login page by signing in as the superadmin
# through the normal POST /auth/login (see apps/web/src/providers/auth-provider.tsx).
#
# - Reuses the API already running on :4000 (start it first: `pnpm dev` or ./start.sh) and the
#   same dev database — anything you do here is real data in that DB.
# - Binds to loopback only: it is an always-superadmin UI, never expose it on the LAN.
# - Open http://127.0.0.1:3100 (not localhost) so its refresh cookie doesn't collide with the
#   main instance on localhost:3000 — cookies are shared across ports on the same host.
# - Uses its own build dir (.next-autologin) so it can run beside `pnpm dev`.
#
# Overrides: AUTOLOGIN_PORT (3100), AUTOLOGIN_EMAIL (superadmin@bmp.local),
#            AUTOLOGIN_PASSWORD (defaults to SEED_USER_PASSWORD from .env).
set -euo pipefail
cd "$(dirname "$0")"

PORT="${AUTOLOGIN_PORT:-3100}"
EMAIL="${AUTOLOGIN_EMAIL:-superadmin@bmp.local}"

# Next rewrites these two tracked files on startup to point at the custom build dir; snapshot them
# and put them back on exit so the working tree (and the main instance's typecheck) stay clean.
SNAP="$(mktemp -d)"
cp apps/web/tsconfig.json apps/web/next-env.d.ts "$SNAP/"
restore() {
  cp "$SNAP/tsconfig.json" apps/web/tsconfig.json
  cp "$SNAP/next-env.d.ts" apps/web/next-env.d.ts
  rm -rf "$SNAP"
}
trap restore EXIT
trap 'exit 130' INT TERM

echo "Auto-login instance: http://127.0.0.1:${PORT}  (signed in as ${EMAIL}; API proxied to :4000)"

pnpm exec dotenv -e .env -- sh -c '
  export NEXT_DIST_DIR=.next-autologin
  export NEXT_PUBLIC_DEV_AUTO_LOGIN_EMAIL="$1"
  export NEXT_PUBLIC_DEV_AUTO_LOGIN_PASSWORD="${AUTOLOGIN_PASSWORD:-$SEED_USER_PASSWORD}"
  cd apps/web && exec pnpm exec next dev --port "$2" --hostname 127.0.0.1
' _ "$EMAIL" "$PORT"
