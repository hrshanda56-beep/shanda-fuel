#!/usr/bin/env bash
set -euo pipefail

# Both application jobs must fail before doing expensive work when the
# dedicated Clerk test instance is not configured. Empty GitHub secret/variable
# expansions are invalid application configuration, not a reason to weaken the
# runtime environment parser or security checks.
test -n "${CLERK_SECRET_KEY-}" || {
  echo 'Configure secret CLERK_TEST_SECRET_KEY for the dedicated Clerk test instance.' >&2
  exit 1
}
test -n "${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY-}" || {
  echo 'Configure variable CLERK_TEST_PUBLISHABLE_KEY for the dedicated Clerk test instance.' >&2
  exit 1
}
