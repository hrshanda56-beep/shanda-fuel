# Stable-runner browser acceptance readiness — 2026-10-17

Status: **BLOCKED — do not start the canonical matrix yet.**

This checklist is for the exact candidate
`70a697422aa1060c3cd76ba3103ee7cbaee5af35` (source `d007e51`). It records a
read-only preflight; it is not browser acceptance evidence.

## Ownership and isolation

- [ ] The active investigation in `/Users/wolftech/.codex/worktrees/9b53/shanda-fuel`
  has finished and its owner has released the runner.
- [ ] Its working tree is no longer changing, and its result SHA and focused
  diagnosis are recorded before integration.
- [ ] Port `3100` is idle. No existing Next.js server is reused.
- [ ] No existing Playwright browser profile, trace directory, or PostgreSQL
  cluster is reused.
- [ ] The acceptance process has a dedicated worktree and a task-owned
  disposable database with a recorded database name, PostgreSQL version and
  loopback endpoint.

Current observation: the investigation is still running. Its Playwright
process (PID 62882), Next.js server (PID 62985), Chromium (PID 63296), and
listener on `127.0.0.1:3100` were present on the final preflight snapshot. Its
worktree had uncommitted changes. Do not stop, attach to, or modify these
processes/files from the acceptance run.

## Resource preflight

- [ ] Record host physical memory, free/available memory, compression/swap,
  CPU load and free space on the actual data volume immediately before launch.
- [ ] Confirm headroom remains after the Next.js development cache, Chromium,
  traces and disposable database are created.
- [ ] Confirm no other browser, test runner, development server or PostgreSQL
  workload will compete for that headroom.
- [ ] Capture the preflight snapshot with a UTC timestamp and retain it beside
  the final Playwright report.

Current observation: this host reports 8 GiB physical RAM, substantial prior
compression/swap activity, and about 2.2 GiB free on the data volume during
this preflight. Existing disposable databases and caches occupy hundreds of
megabytes to gigabytes. This does not satisfy a resource-stable exclusive-run
prerequisite.

## Candidate and test baseline

- [ ] `git status --short` is empty in the acceptance worktree.
- [ ] `git rev-parse HEAD` equals the approved candidate SHA recorded by the
  release owner.
- [ ] The application/test/config diff is reviewed against the approved
  source; no deferred performance, onboarding or Phase 2 changes are present.
- [ ] The canonical command is recorded exactly, including environment,
  worker count, retry count, reporter, trace policy and screenshot directory.
- [ ] The run uses the development-mode Playwright configuration and all
  assertions. Do not add retries, sleeps, timeout increases or skips.
- [ ] The four screenshot cases run with an explicitly task-owned
  `SCREENSHOT_DIR`; their opt-in skip is not accepted for the final matrix.

## Acceptance result required to close the gate

- [ ] Every scheduled test executes, including the previously serial
  reconciliation case.
- [ ] Result records exact SHA, UTC start/end, database identity/version,
  runtime versions, runner resource snapshots and complete pass/fail/flaky/
  skipped/not-run counts.
- [ ] Any focused rerun is diagnostic only; after a code change, the complete
  matrix is rerun on the same or better isolated runner.
- [ ] The final report links failure traces/logs and independently reviews the
  candidate. A green focused subset cannot substitute for the complete matrix.
- [ ] MFA evidence still includes expired-step-up denial, unchanged
  `SUBMITTED` reconciliation/no postings, and fresh-step-up approval with the
  expected approver, audit trail and exactly-once postings.

## Stop conditions

Stop without launching the matrix if any ownership, port, worktree, database,
browser-profile or resource check is unresolved. Record the concrete blocker
as **BLOCKED**, preserve the approved candidate, and leave the release **NO-GO**.

No production or staging systems, provider configuration, migration, push,
merge or deployment is part of this checklist.
