# Technical defaults

No client-specific production values are embedded in this repository.

Technical defaults that do not change business meaning will be recorded here as implementation proceeds. Business facts such as stations, bank accounts, tanks, calibration points, suppliers, customers, thresholds, and opening balances belong in onboarding data.

## A0 engineering defaults

- Node.js `24.x` is the supported local/CI runtime family; the repository declares `>=24 <27`.
- pnpm `11.25.0` is pinned through `packageManager` and CI setup.
- Next.js `16.x` App Router with the Node runtime is the application foundation.
- React `19.x`, strict TypeScript, ESLint flat configuration, and Prettier provide the baseline quality gates.
- Vitest is the unit/integration test runner; Playwright with axe is the browser/accessibility harness.
- Drizzle ORM with the `postgres` driver is the PostgreSQL boundary. Runtime access is pooled; migrations use the direct URL convention.
- `decimal.js` is the exact application-boundary arithmetic implementation for money, litres, prices, and weighted-average cost primitives.
- Domain decimal constructors enforce the Blueprint scales without silent rounding: Money `NUMERIC(20,4)`, Litres `NUMERIC(18,3)`, UnitPrice `NUMERIC(20,6)`, WeightedAverageCost `NUMERIC(20,8)`, IntermediateDecimal `NUMERIC(24,8)`, and Ratio `NUMERIC(18,8)`. Explicit `quantize` calls are the only rounding boundary.
- A0 creates only the `auth`, `app`, and `platform` PostgreSQL namespaces. Business tables, RLS policies, and production credentials remain owned by later workstreams.
