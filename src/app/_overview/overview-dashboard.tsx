import { EmptyState } from '@/design-system/primitives';

/**
 * Production boundary for the overview until live reporting data is available.
 * Never replace these states with sample values or a silent fallback after a
 * fetch failure.
 */
export function ProductionSafeOverview() {
  return (
    <div className="overview">
      <div className="overview-title">
        <div>
          <h1 id="page-title">Dashboard</h1>
          <p className="overview-sample">
            Live figures are not available for this work context yet.
          </p>
        </div>
      </div>

      <section className="overview-section" aria-labelledby="today-heading">
        <h2 id="today-heading">Today at a glance</h2>
        <div className="card">
          <EmptyState
            layout="block"
            headingLevel={3}
            title="No live metrics available"
            message="Choose an authorised work context above to view current financial and operational figures."
          />
        </div>
      </section>

      <section className="overview-section" aria-labelledby="stats-heading">
        <h2 id="stats-heading">Statistics by period</h2>
        <div className="card">
          <EmptyState
            layout="block"
            headingLevel={3}
            title="No trends available"
            message="Period charts will appear when reporting data is available for this context."
          />
        </div>
      </section>

      <section className="overview-section" aria-labelledby="attention-heading">
        <h2 id="attention-heading">Needs attention</h2>
        <div className="card">
          <EmptyState
            layout="block"
            headingLevel={3}
            title="No open items available"
            message="Open items will appear here when the attention feed is available."
          />
        </div>
      </section>
    </div>
  );
}
