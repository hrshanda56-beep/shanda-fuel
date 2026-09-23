import { Button, Card, ErrorState, StatusBadge } from '../../../design-system/primitives';
import Link from 'next/link';

export type ForecourtWorkspaceProps = {
  businessDate: string;
  shiftLabel: string;
  shiftState: 'PLANNED' | 'OPEN' | 'METER_CLOSED' | 'COMPLETED' | 'NOT_OPERATED';
  openNozzles: number;
  sealedNozzles: number;
  reconciliationState:
    'DRAFT' | 'READY' | 'PENDING_APPROVAL' | 'RETURNED' | 'APPROVED' | 'POSTED' | 'LOCKED';
  connection: 'online' | 'draft-only';
  reconciliationHref?: string;
};

/** Presentation-only operational surface. Authoritative actions must call named server commands. */
export function ForecourtWorkspace({
  businessDate,
  shiftLabel,
  shiftState,
  openNozzles,
  sealedNozzles,
  reconciliationState,
  connection,
  reconciliationHref,
}: ForecourtWorkspaceProps) {
  const canAuthoritativelyAct = connection === 'online';
  return (
    <section id="forecourt" aria-labelledby="forecourt-title">
      <div className="section-heading">
        <p className="eyebrow">Core forecourt</p>
        <h2 id="forecourt-title">Keep today’s station moving</h2>
        <p>
          {businessDate} · {shiftLabel}. Meter quantities are server-derived; this screen never
          treats a local draft as posted truth.
        </p>
      </div>
      <div className="content-grid">
        <Card as="section" className="panel" aria-labelledby="shift-panel-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Shift workflow</p>
              <h3 id="shift-panel-title">{shiftLabel}</h3>
            </div>
            <StatusBadge tone={shiftState === 'COMPLETED' ? 'positive' : 'pending'}>
              {shiftState.replaceAll('_', ' ')}
            </StatusBadge>
          </div>
          <dl className="operational-summary">
            <div>
              <dt>Active nozzle segments</dt>
              <dd>{openNozzles}</dd>
            </div>
            <div>
              <dt>Sealed nozzle segments</dt>
              <dd>{sealedNozzles}</dd>
            </div>
          </dl>
          <div className="form-actions">
            <Button variant="primary" disabled={!canAuthoritativelyAct}>
              {shiftState === 'PLANNED' ? 'Start shift' : 'Open shift workflow'}
            </Button>
            <Button variant="secondary" disabled={!canAuthoritativelyAct || shiftState !== 'OPEN'}>
              Close meters
            </Button>
          </div>
          {connection === 'draft-only' ? (
            <ErrorState
              title="Draft capture only"
              message="Meter drafts may be captured locally. Start, seal, and close commands require server confirmation."
            />
          ) : null}
        </Card>

        <Card as="section" className="panel" aria-labelledby="reconciliation-panel-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Daily reconciliation</p>
              <h3 id="reconciliation-panel-title">Meter-derived accountability</h3>
            </div>
            <StatusBadge tone={reconciliationState === 'LOCKED' ? 'locked' : 'informational'}>
              {reconciliationState.replaceAll('_', ' ')}
            </StatusBadge>
          </div>
          <p>
            Review payment declarations against sealed meter segments. Variances require an
            explanation; approval is for an exact immutable revision.
          </p>
          <div className="form-actions">
            <Button variant="secondary" disabled={!canAuthoritativelyAct}>
              Review reconciliation
            </Button>
            {reconciliationHref ? (
              <Link className="button button-quiet" href={reconciliationHref}>
                Open guided workflow
              </Link>
            ) : null}
            <Button variant="quiet" disabled={!canAuthoritativelyAct}>
              View exceptions
            </Button>
          </div>
        </Card>
      </div>
    </section>
  );
}
