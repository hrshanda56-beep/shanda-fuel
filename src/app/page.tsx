import { AppShell } from '@/design-system/app-shell';
import {
  Button,
  Card,
  ConflictState,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  OfflineBanner,
  StatusBadge,
} from '@/design-system/primitives';

const demoPermissions = [
  'operations:view',
  'actions:view',
  'money:view',
  'reports:view',
  'settings:view',
] as const;

export default function HomePage() {
  return (
    <AppShell
      grantedPermissions={demoPermissions}
      context={{
        organisation: 'Demo organisation',
        station: 'Demo station',
        businessDate: '20 Sep 2026',
      }}
      role="Supervisor"
      userName="Demo user"
    >
      <OfflineBanner />
      <div className="page-header">
        <div>
          <p className="eyebrow">Supervisor workspace</p>
          <h1 id="page-title">Good morning, Demo user</h1>
          <p className="lede">A calm, exception-first view of today’s station work.</p>
        </div>
        <StatusBadge tone="positive">Context selected</StatusBadge>
      </div>

      <section className="metric-grid" aria-label="Synthetic station summary">
        <Card className="metric-card">
          <span className="metric-label">Shift progress</span>
          <strong className="metric-value">2 of 3</strong>
          <span className="metric-meta">Synthetic operational preview</span>
        </Card>
        <Card className="metric-card">
          <span className="metric-label">Open tasks</span>
          <strong className="metric-value">4</strong>
          <span className="metric-meta">2 need attention</span>
        </Card>
        <Card className="metric-card">
          <span className="metric-label">Connection</span>
          <strong className="metric-value">Draft safe</strong>
          <span className="metric-meta">No authoritative action pending</span>
        </Card>
      </section>

      <div className="content-grid">
        <Card as="section" className="panel" id="actions" aria-labelledby="actions-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Next actions</p>
              <h2 id="actions-title">Keep the station moving</h2>
            </div>
            <StatusBadge tone="warning">2 exceptions</StatusBadge>
          </div>
          <div className="action-list">
            <article className="action-row">
              <div>
                <StatusBadge tone="critical">Needs review</StatusBadge>
                <h3>Close the current shift</h3>
                <p>Confirm meter readings before the reconciliation can be calculated.</p>
              </div>
              <Button variant="secondary" type="button">
                Open task
              </Button>
            </article>
            <article className="action-row">
              <div>
                <StatusBadge tone="neutral">Ready</StatusBadge>
                <h3>Review the delivery draft</h3>
                <p>Draft evidence is stored locally until the connection is restored.</p>
              </div>
              <Button variant="quiet" type="button">
                View draft
              </Button>
            </article>
          </div>
        </Card>

        <Card as="section" className="panel" id="operations" aria-labelledby="operations-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Today</p>
              <h2 id="operations-title">Operations overview</h2>
            </div>
            <a className="text-link" href="#operations">
              View all
            </a>
          </div>
          <div className="responsive-table-wrap">
            <table className="responsive-table">
              <caption className="visually-hidden">Synthetic operations overview</caption>
              <thead>
                <tr>
                  <th scope="col">Work item</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td data-label="Work item">Morning shift</td>
                  <td data-label="Owner">Demo team</td>
                  <td data-label="Status">
                    <StatusBadge tone="positive">Open</StatusBadge>
                  </td>
                </tr>
                <tr>
                  <td data-label="Work item">Meter close</td>
                  <td data-label="Owner">Demo supervisor</td>
                  <td data-label="Status">
                    <StatusBadge tone="warning">Waiting</StatusBadge>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <section className="foundation-showcase" aria-labelledby="showcase-title">
        <div className="section-heading">
          <p className="eyebrow">UI foundation</p>
          <h2 id="showcase-title">Truthful states and accessible controls</h2>
          <p>These synthetic examples are the shared patterns feature workflows can consume.</p>
        </div>
        <div className="state-grid">
          <Card className="state-card">
            <h3>Loading</h3>
            <LoadingState label="Refreshing station context" />
          </Card>
          <Card className="state-card">
            <h3>Empty</h3>
            <EmptyState
              title="No drafts yet"
              message="Saved drafts will appear here on this device."
            />
          </Card>
          <Card className="state-card">
            <h3>Error</h3>
            <ErrorState
              message="The latest task could not be loaded."
              action={<Button variant="secondary">Retry</Button>}
            />
          </Card>
          <Card className="state-card">
            <h3>Conflict</h3>
            <ConflictState />
          </Card>
        </div>
      </section>

      <Card as="section" className="form-panel" aria-labelledby="form-title">
        <div className="section-heading">
          <p className="eyebrow">Form pattern</p>
          <h2 id="form-title">Persistent labels, clear help</h2>
        </div>
        <form className="demo-form">
          <Field id="note" label="Draft note" hint="This is local-only synthetic content." required>
            <input id="note" name="note" type="text" placeholder="Add a short note" />
          </Field>
          <Field id="reason" label="Reason" error="A reason is required before submission.">
            <textarea id="reason" name="reason" rows={3} placeholder="Explain the exception" />
          </Field>
          <div className="form-actions">
            <Button type="button" variant="primary">
              Save draft
            </Button>
            <Button type="button" variant="quiet">
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </AppShell>
  );
}
