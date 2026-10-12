#!/usr/bin/env bash
# Proves a PRODUCTION server (`next build` + `next start`) denies every
# development-only route: HTTP 404, no Set-Cookie, no synthetic content.
# Usage: scripts/ci/assert-dev-routes-denied.sh [base-url]   (default http://127.0.0.1:3100)
# Read-only: only GET/POST/HEAD against the given base URL. Never point it at a
# shared or production host; it is meant for the CI or local disposable server.
set -u
BASE="${1:-http://127.0.0.1:3100}"
case "$BASE" in
  http://127.0.0.1:*|http://localhost:*|http://\[::1\]:*) ;;
  *) echo "refusing non-loopback base URL: $BASE" >&2; exit 2 ;;
esac

# Every routable development-only URL (dynamic segments use placeholder values).
PATHS="
/dev-preview
/dev-preview?scenario=normal
/dev-preview/attendant
/dev-preview/scenarios
/dev-preview/valuation
/dev-preview/valuation/revaluations/x
/dev-preview/valuation/streams/x/y
/dev-preview/scenario/normal
/dev-preview/scenario/normal?tenantId=t
/dev-preview/api/my-shift
/design-system
/design-system/entry
/design-system/entry?state=long
/foundation
"
# CONTENT that exists only in synthetic previews or the internal reference.
# (Route <title> text can still appear inside a 404's metadata payload; that is
# a route name, not data, and is deliberately not asserted here.)
MARKERS='SAMPLE DATA|preview-sample-banner|Shanda Fuel \(preview\)|Shanda Energy Ltd|Pick one, then use|Design system foundation|T\.E\.I Oils|Good morning, Demo user|Readable operational values'

fail=0
check() { # method path
  method="$1"; path="$2"
  hdr="$(mktemp)"; body="$(mktemp)"
  code="$(curl -sS -m 20 -X "$method" -o "$body" -D "$hdr" -w '%{http_code}' "$BASE$path" || echo 000)"
  problems=""
  if [ "$method" = "POST" ]; then
    # Handlers export GET only; the framework answers other methods with 405 and
    # no body or cookie. 404 is equally fine. Anything 2xx/3xx is not.
    case "$code" in 404|405) : ;; *) problems="$problems status=$code(expected 404/405);" ;; esac
  else
    [ "$code" = "404" ] || problems="$problems status=$code(expected 404);"
  fi
  if grep -qi '^set-cookie:' "$hdr"; then problems="$problems set-cookie-present;"; fi
  if grep -qi '^location:' "$hdr"; then problems="$problems redirect-present;"; fi
  if grep -qiE '^content-type:[[:space:]]*application/json' "$hdr"; then problems="$problems json-response;"; fi
  if [ "$method" != "HEAD" ] && grep -qE "$MARKERS" "$body"; then problems="$problems synthetic-content;"; fi
  if [ -n "$problems" ]; then
    echo "FAIL $method $path:$problems"; fail=1
  else
    echo "ok   $method $path -> $code"
  fi
  rm -f "$hdr" "$body"
}

for p in $PATHS; do check GET "$p"; done
# Handlers must not act on other methods either.
for p in /dev-preview/scenario/normal /dev-preview/api/my-shift; do
  check POST "$p"
  check HEAD "$p"
done
# Control: the real app must be up, otherwise 404s above could mean "server down".
ctl="$(curl -sS -m 20 -o /dev/null -w '%{http_code}' "$BASE/api/health" || echo 000)"
if [ "$ctl" != "200" ]; then echo "FAIL control /api/health -> $ctl (server not healthy)"; fail=1; fi

if [ "$fail" -ne 0 ]; then echo "development-only routes are NOT fully denied"; exit 1; fi
echo "all development-only routes denied by the production server"
