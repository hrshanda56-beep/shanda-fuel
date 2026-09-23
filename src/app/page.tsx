import { AppShell } from '@/design-system/app-shell';
import { ForecourtWorkspace } from '@/modules/forecourt/ui/forecourt-workspace';
import {
  formatBusinessDate,
  formatLitres,
  formatMoney,
  formatPercentage,
} from '@/design-system/formatters';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import {
  AccessDeniedState,
  Button,
  Card,
  ConflictState,
  BottomSheet,
  DialogFrame,
  EvidenceFile,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  NotFoundState,
  NumericInput,
  OfflineBanner,
  RiskConfirmation,
  Skeleton,
  StatusBadge,
  SuccessState,
} from '@/design-system/primitives';

export default function HomePage() {
  return (
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      context={{
        organisation: 'Demo organisation',
        station: 'Demo station',
        businessDate: '20 Sep 2026',
        shift: 'Morning shift',
      }}
      role="Supervisor"
      userName="Demo user"
      breadcrumbs={[{ label: 'Home' }]}
    >
      <OfflineBanner />
      <ForecourtWorkspace
        businessDate="20 Sep 2026"
        shiftLabel="Morning shift"
        shiftState="OPEN"
        openNozzles={2}
        sealedNozzles={0}
        reconciliationState="DRAFT"
        connection="online"
        reconciliationHref="/stations/demo-station/reconciliations/new"
      />
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

      <section className="formatting-grid" aria-labelledby="formatting-title">
        <div className="section-heading">
          <p className="eyebrow">Presentation-only formatting</p>
          <h2 id="formatting-title">Readable operational values</h2>
          <p>Values are synthetic display examples; server/domain code remains authoritative.</p>
        </div>
        <div className="formatting-values">
          <Card className="format-card">
            <span className="metric-label">Money</span>
            <strong className="numeric format-value">{formatMoney('12500.00')}</strong>
          </Card>
          <Card className="format-card">
            <span className="metric-label">Litres</span>
            <strong className="numeric format-value">{formatLitres('1050.375')}</strong>
          </Card>
          <Card className="format-card">
            <span className="metric-label">Variance</span>
            <strong className="numeric format-value">{formatPercentage('4.25')}</strong>
          </Card>
          <Card className="format-card">
            <span className="metric-label">Business date</span>
            <strong className="format-value">{formatBusinessDate('2026-09-20')}</strong>
          </Card>
        </div>
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
            <h3>Success</h3>
            <SuccessState message="The draft is saved locally and awaits online confirmation." />
          </Card>
          <Card className="state-card">
            <h3>Conflict</h3>
            <ConflictState />
          </Card>
          <Card className="state-card">
            <h3>Skeleton</h3>
            <Skeleton lines={3} />
          </Card>
          <Card className="state-card">
            <h3>Permission</h3>
            <AccessDeniedState />
          </Card>
          <Card className="state-card">
            <h3>Not found</h3>
            <NotFoundState />
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
          <NumericInput
            id="quantity"
            name="quantity"
            label="Quantity"
            hint="Use the unit shown; authoritative validation happens on the server."
            unit="L"
            placeholder="0.000"
            optional
          />
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

      <section className="component-grid" aria-labelledby="component-title">
        <div className="section-heading">
          <p className="eyebrow">Risk and evidence patterns</p>
          <h2 id="component-title">Explicit before authoritative action</h2>
          <p>These controls describe consequences and evidence state without posting anything.</p>
        </div>
        <RiskConfirmation
          title="Return reconciliation"
          consequence="The current revision will go back for correction and cannot be approved as submitted."
          actionLabel="Return reconciliation"
        />
        <EvidenceFile
          name="delivery-note-demo.pdf"
          state="verified"
          detail="Synthetic evidence · private storage reference pending A0 platform wiring"
        />
        <div className="modal-demo-grid">
          <DialogFrame
            trigger={<Button variant="secondary">Open accessible dialog</Button>}
            title="Confirm return"
            description="This is a synthetic modal surface for future named commands."
          >
            <p>Focus is contained here until the dialog is closed.</p>
          </DialogFrame>
          <BottomSheet
            trigger={<Button variant="quiet">Open mobile sheet</Button>}
            title="Quick context"
            description="Short contextual tasks can use this responsive presentation."
          >
            <p>Longer workflows should remain full pages.</p>
          </BottomSheet>
        </div>
      </section>
    </AppShell>
  );
}
