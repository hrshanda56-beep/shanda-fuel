import { EmptyState, StatusBadge } from '@/design-system/primitives';

/**
 * Production boundary for the overview until live reporting data is available.
 * The root entry gate guarantees that this surface only renders after a valid
 * work context has been resolved.
 */
export function ProductionSafeOverview() {
  return (
    <div className="today" aria-label="Today overview">
      <section className="today-hero" aria-labelledby="today-hero-heading">
        <div>
          <p className="eyebrow">Station position</p>
          <h2 id="today-hero-heading">Keep today moving</h2>
          <p className="lede">
            Start with the current shift, then review sales, cash, and stock as evidence becomes
            available.
          </p>
        </div>
        <StatusBadge tone="neutral">Waiting for live evidence</StatusBadge>
      </section>

      <section className="today-next-action card" aria-labelledby="today-next-action-heading">
        <div className="today-next-action-copy">
          <p className="eyebrow">Next action</p>
          <h2 id="today-next-action-heading">Review today’s evidence</h2>
          <p>
            Start with the current shift, then review sales, cash, stock, and exceptions as they
            become available.
          </p>
        </div>
        <dl className="today-stage-summary">
          <div>
            <dt>Shift</dt>
            <dd>Not started</dd>
          </div>
          <div>
            <dt>Evidence</dt>
            <dd>Not available</dd>
          </div>
          <div>
            <dt>Attention</dt>
            <dd>Not available</dd>
          </div>
        </dl>
      </section>

      <section className="overview-section" aria-labelledby="today-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Operational position</p>
            <h2 id="today-heading">Today at a glance</h2>
          </div>
        </div>
        <div className="today-empty-grid">
          <div className="card">
            <EmptyState
              layout="block"
              headingLevel={3}
              title="Live position is not available yet"
              message="Sales, litres, and cash will appear here when today’s operational evidence is recorded."
            />
          </div>
          <div className="card">
            <EmptyState
              layout="block"
              headingLevel={3}
              title="No current shift to review"
              message="Shift progress and the next step will appear here when today’s shift is opened."
            />
          </div>
        </div>
      </section>

      <section className="overview-section" aria-labelledby="stats-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Trends</p>
            <h2 id="stats-heading">Statistics by period</h2>
          </div>
        </div>
        <div className="card">
          <EmptyState
            layout="block"
            headingLevel={3}
            title="No trend data yet"
            message="Period comparisons will appear after enough operational evidence has been recorded."
          />
        </div>
      </section>

      <section className="overview-section" aria-labelledby="attention-heading">
        <h2 id="attention-heading">Needs attention</h2>
        <div className="card">
          <EmptyState
            layout="block"
            headingLevel={3}
            title="No exceptions recorded"
            message="Exceptions will rise here with a clear next action when evidence needs attention."
          />
        </div>
      </section>

      <section className="overview-section" aria-labelledby="activity-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Audit trail</p>
            <h2 id="activity-heading">Recent activity</h2>
          </div>
        </div>
        <div className="card">
          <EmptyState
            layout="block"
            headingLevel={3}
            title="No recent activity yet"
            message="Recorded shift, stock, and finance activity will appear here as work is completed."
          />
        </div>
      </section>
    </div>
  );
}
