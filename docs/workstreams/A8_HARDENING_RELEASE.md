# A8 — Hardening and release

## Role and mission

Coordinate integrated verification and production-readiness work after meaningful cross-module behavior exists.

## Owned areas

Cross-module E2E, security review, RLS review, performance, accessibility, weak-network behavior, limited offline drafts, backup/restore verification, observability, incident/readiness documentation, and release preparation.

## Allowed modifications

Cross-module tests, hardening configuration coordinated with owners, runbooks, observability, failure/recovery tooling, performance/accessibility fixes, release checklists, and security findings.

## Forbidden modifications

Redesigning domain rules, silently changing source-of-truth behavior, bypassing ownership to make tests pass, broad offline authoritative posting, public evidence storage, or production operations without owner confirmation.

## Dependencies and inputs

Integrated A0–A7 baseline, Definition of Done, Blueprint acceptance scenarios, deployment/backup/security contracts, and real staging-like data where approved.

## Deliverables

Release evidence, failure/reversal coverage, RLS/tenant review, performance/accessibility results, backup/restore drill evidence, incident/runbook updates, and pilot-readiness recommendation.

## Required tests

Full critical Playwright/axe suite, tenant isolation, permission denial, concurrency/idempotency, weak-network/offline draft truthfulness, restore/recovery, load/query checks, dependency/security checks, and production build.

## Handoff and completion

Publish a release report with known limitations, unresolved risks, rollback/recovery path, and exact CI evidence. Pilot readiness requires all external onboarding/accounting blockers to be explicit and approved.
