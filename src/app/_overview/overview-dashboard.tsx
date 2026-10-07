import { EmptyState, StatusBadge } from '@/design-system/primitives';

/**
 * Production boundary for the overview until live reporting data is available.
 * Never replace these states with sample values or a silent fallback after a
 * fetch failure.
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
        <StatusBadge tone="neutral">Waiting for work context</StatusBadge>
      </section>

      <section className="today-next-action card" aria-labelledby="today-next-action-heading">
        <div className="today-next-action-copy">
          <p className="eyebrow">Next action</p>
          <h2 id="today-next-action-heading">Select an authorised station</h2>
          <p>
            Choose a work context above to unlock the live shift, figures, and exceptions for the
            station you are working on.
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
              title="Live position is not available"
              message="Sales, litres, and cash will appear here after you choose an authorised work context."
            />
          </div>
          <div className="card">
            <EmptyState
              layout="block"
              headingLevel={3}
              title="Current shift is not available"
              message="Shift progress and the next step will appear here for the selected station."
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
            title="No trend data for this context"
            message="Period comparisons will appear when reporting data is available for the selected station."
          />
        </div>
      </section>

      <section className="overview-section" aria-labelledby="attention-heading">
        <h2 id="attention-heading">Needs attention</h2>
        <div className="card">
          <EmptyState
            layout="block"
            headingLevel={3}
            title="No attention feed available"
            message="Exceptions will rise here with a clear next action when the station context is selected."
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
            title="No recent activity available"
            message="Recorded shift, stock, and finance activity will appear here after a work context is selected."
          />
        </div>
      </section>
    </div>
  );
}
