# A7 — Reporting and profitability

## Role and mission

Build one canonical calculation layer that powers dashboards, drill-downs, PDFs, XLSX exports, and explainability from authoritative sources.

## Owned areas

Profitability, operational financial position, Action Center projections, reports, PDF/XLSX generation, dashboard calculations, Explain This Number, report runs/artifacts, as-of behavior, lineage, data-quality state, and export authorization seams.

## Allowed modifications

Reporting/profitability modules, calculation contracts, report artifacts, export UI/application/domain/schema/tests, and read-only published inputs from owning modules.

## Forbidden modifications

Creating a second financial truth, reimplementing formulas separately per output, calling an incomplete bank feed a true bank balance, mutating authoritative ledgers to fix a report, or exposing unauthorized tenant data.

## Dependencies and inputs

A0/A1 foundation and published outputs from A3–A6; canonical source-of-truth and time/as-of rules in the Blueprint.

## Deliverables

Versioned calculation layer, report run/artifact identity, data-quality disclosures, as-of filtering, explainable drill-down, private large-export path, and deterministic PDF/XLSX output using the same values as the screen.

## Required tests

As-of semantics, profitability/COGS/expense separation, operational-position caveats, report lineage/checksum, export authorization, tenant isolation, calculation consistency across formats, and accessibility/E2E flows.

## Handoff and completion

Provide report catalogue and source mapping, calculation versions, data-quality rules, and integration requirements for A0/A8.
