#!/usr/bin/env bash
# Proves a built (`next build` + `next start`) server ignores the synthetic E2E
# navigation fixture header, even though CI runs it with APP_ENV=test: with the header
# every protected page must behave exactly as without it (redirect/sign-in), and no
# fixture content may be served. Loopback only; read-only GETs.
# Usage: scripts/ci/assert-navigation-fixture-denied.sh [base-url]  (default http://127.0.0.1:3100)
set -u
BASE="${1:-http://127.0.0.1:3100}"
case "$BASE" in
  http://127.0.0.1:*|http://localhost:*|http://\[::1\]:*) ;;
  *) echo "refusing non-loopback base URL: $BASE" >&2; exit 2 ;;
esac
HEADER='x-shanda-e2e-navigation-fixture: synthetic'
# Content only the fixture can produce (synthetic tenant/station ids, a signed-in shell).
MARKERS='e2e-tenant|e2e-station|aria-label="Primary navigation"|Operations control room'
PATHS="/ /settings /my-shift /operations/daily /reports /inventory/valuation /suppliers /customers"

fail=0
fetch() { # path with_header(0|1) -> prints "code|location|markers-found"
  local hdr body code loc found
  hdr="$(mktemp)"; body="$(mktemp)"
  if [ "$2" = 1 ]; then code="$(curl -sS -m 30 -H "$HEADER" -o "$body" -D "$hdr" -w '%{http_code}' "$BASE$1" || echo 000)"
  else code="$(curl -sS -m 30 -o "$body" -D "$hdr" -w '%{http_code}' "$BASE$1" || echo 000)"; fi
  loc="$(grep -i '^location:' "$hdr" | tr -d '\r' | head -1 | cut -d' ' -f2-)"
  found="$(grep -Eo "$MARKERS" "$body" | sort -u | tr '\n' ',')"
  rm -f "$hdr" "$body"
  echo "$code|$loc|$found"
}
for p in $PATHS; do
  without="$(fetch "$p" 0)"; with="$(fetch "$p" 1)"
  if [ "$with" != "$without" ]; then
    echo "FAIL $p: header changes the response (with=[$with] without=[$without])"; fail=1
  elif [ -n "${with##*|}" ]; then
    echo "FAIL $p: fixture content served: ${with##*|}"; fail=1
  else
    echo "ok   $p -> ${with%%|*} (header ignored)"
  fi
done
ctl="$(curl -sS -m 20 -o /dev/null -w '%{http_code}' "$BASE/api/health" || echo 000)"
[ "$ctl" = 200 ] || { echo "FAIL control /api/health -> $ctl (server not healthy)"; fail=1; }
[ $fail -eq 0 ] && echo "synthetic navigation fixture is denied by the built server" || echo "synthetic navigation fixture is NOT denied"
exit $fail
