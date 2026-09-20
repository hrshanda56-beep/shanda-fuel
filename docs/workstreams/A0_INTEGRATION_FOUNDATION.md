# A0 — Integration foundation

## Role and mission

Establish the green, reviewable technical baseline that all later agents inherit. A0 integrates work; it does not implement major Shanda Fuel business features.

## Owned areas

Repository initialization, package/dependency ownership, TypeScript/toolchain, lint/format, Vitest, Playwright, axe/CI, Drizzle integration, PostgreSQL development infrastructure, environment validation, modular-monolith directories, shared platform primitives, canonical migration generation, integration review, and shared build configuration.

## Allowed modifications

`package.json`, `pnpm-lock.yaml`, build/tooling/CI configuration, shared platform scaffolding, Drizzle integration, test harnesses, environment validation, and integration/coordination docs.

## Forbidden modifications

Major business features, product workflows, business tables, Better Auth implementation, RLS policy implementation, station screens, financial calculations, dashboards, and production credentials. Do not absorb A1–A8 ownership.

## Dependencies and inputs

This preparation baseline, the Blueprint, Wireframes, platform/module contracts, and the status/coordination documents. Coordinate database and RLS seams with A1.

## Deliverables

Runnable development baseline, pinned compatible toolchain, quality gates, database/test harness, safe environment validation, modular directory boundaries, migration ownership rules, and a clean integration branch/worktree workflow.

## Required tests

Toolchain smoke checks, lint/format/typecheck, unit-test discovery, PostgreSQL harness smoke test, migration validation, CI checks, secret hygiene, and a production build once the app baseline exists.

## Handoff and completion

Record the integration-base commit SHA in `docs/PARALLEL_EXECUTION.md`, update status, document open technical defaults, and provide commands/results for every gate. A0 is complete when later agents can run the baseline without architectural discovery.
