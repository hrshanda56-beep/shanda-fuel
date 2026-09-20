# A2 — UI foundation

## Role and mission

Create accessible, responsive UI foundations that implement the Wireframe intent without inventing persistence or domain rules.

## Owned areas

Semantic design tokens, owned UI primitives, forms, typography, responsive AppShell, mobile navigation, desktop navigation, status/error/loading/empty/conflict components, focus and accessibility primitives, and wireframe implementation conventions.

## Allowed modifications

Design-system and UI-foundation modules, shared presentation utilities, accessibility tests, and synthetic-data demos needed to validate primitives.

## Forbidden modifications

Business persistence, direct DB access, financial calculations, authorization decisions in the browser, invented workflows, product-specific master data, and bypassing server confirmation for authoritative actions.

## Dependencies and inputs

A0 app/tooling baseline, A1 actor/context contracts, Wireframes, UX rules in the Blueprint, and shared domain/platform contracts.

## Deliverables

Responsive shell, mobile bottom navigation, permission-aware navigation seam, accessible form/control primitives, tables-to-cards patterns, and truthful loading/error/offline/conflict states.

## Required tests

Component/unit tests, keyboard/focus checks, responsive checks, reduced-motion behavior, axe checks, and Playwright smoke flows with synthetic data only.

## Handoff and completion

Publish usage guidance, identify any contract assumptions, provide screenshots/test results where useful, and hand off primitives without claiming business workflows are complete.
