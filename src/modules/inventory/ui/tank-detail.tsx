'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useConfirm, useToast } from '@/design-system/feedback-provider';
import { PageHeader } from '@/design-system/layout';
import { Notice } from '@/design-system/feedback';
import { formatBusinessDate, formatLitres } from '@/design-system/formatters';
import { Modal } from '@/design-system/modal';
import { Button, Card, EmptyState, Field, StatusBadge } from '@/design-system/primitives';
import { TableScrollRegion } from '@/design-system/table';
import { StepUpDialog } from '@/modules/setup/ui/step-up-dialog';
import type { StockSignal } from '../../approvals/operations-alerts';
import { parseCalibrationText } from '../calibration';
import type { TankDetail } from '../tank-detail';
import {
  TANK_TABS,
  dipSentence,
  fillPercent,
  runningBalances,
  tankTabFrom,
  type TankTab,
} from './tank-detail-model';

const SIGNAL: Record<
  StockSignal,
  { tone: 'positive' | 'warning' | 'critical' | 'neutral'; label: string; short: string }
> = {
  ok: { tone: 'positive', label: 'Green: matches the books', short: 'it matched the books' },
  watch: {
    tone: 'warning',
    label: 'Yellow: explain it',
    short: 'a small difference that needs explaining',
  },
  alert: { tone: 'critical', label: 'Red: urgent', short: 'it was well off the books' },
  unjudged: {
    tone: 'neutral',
    label: 'Not checked',
    short: 'no limit was set to judge it against',
  },
};

const MOVEMENT_LABELS: Record<string, string> = {
  OPENING_BALANCE: 'Opening stock',
  DELIVERY: 'Delivery',
  SALE: 'Sale',
  ADJUSTMENT: 'Stock adjustment',
};

/** Date and time in the station's own timezone, never the viewer's. */
function stationDateTime(value: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(new Date(value));
  } catch {
    return '—';
  }
}

const LITRES = /^\d+(?:\.\d{1,3})?$/;

function signed(value: string): string {
  const text = formatLitres(value);
  return value.startsWith('-') || value === '0' ? text : `+${text}`;
}

export function TankDetailView({
  context,
  inventoryHref,
  streamHref,
  initialData,
  initialTab,
}: Readonly<{
  context: { tenantId: string; stationId: string; stationName: string };
  inventoryHref: string;
  streamHref: string;
  initialData: TankDetail;
  /** The tab named in the address, so a refresh stays where the person was. */
  initialTab?: string;
}>) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const { tank, dips, movements, canManage, stationTimezone, chart } = initialData;
  const [chartUnit, setChartUnit] = useState(chart?.unit ?? 'mm');
  const [chartText, setChartText] = useState('');
  const [chartSaving, setChartSaving] = useState(false);
  const [chartMessage, setChartMessage] = useState<{
    tone: 'positive' | 'critical';
    text: string;
  } | null>(null);
  const [yellow, setYellow] = useState(tank.yellowLitres ?? '');
  const [red, setRed] = useState(tank.redLitres ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'positive' | 'critical'; text: string } | null>(
    null,
  );
  const [stepUpRetry, setStepUpRetry] = useState<'limits' | 'chart' | null>(null);
  const [voidingDipId, setVoidingDipId] = useState<string | null>(null);

  const availableTabs = TANK_TABS.filter((item) => item.value !== 'settings' || canManage);
  const [tab, setTab] = useState<TankTab>(() => tankTabFrom(initialTab, canManage));
  const [dipOpen, setDipOpen] = useState(false);
  const [dipLitres, setDipLitres] = useState(
    tank.bookLitres.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''),
  );
  const [dipSaving, setDipSaving] = useState(false);
  const [dipError, setDipError] = useState<string | null>(null);

  function selectTab(next: TankTab) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(window.history.state, '', url);
  }

  async function recordDip() {
    const litresText = dipLitres.trim();
    if (!LITRES.test(litresText)) {
      setDipError('Enter the litres you measured, for example 19500.');
      return;
    }
    setDipSaving(true);
    setDipError(null);
    try {
      const response = await fetch('/api/inventory/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          commandType: 'RecordTankDip',
          tenantId: context.tenantId,
          stationId: context.stationId,
          tankId: tank.id,
          measuredAt: new Date().toISOString(),
          physicalLitres: litresText,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        throw new Error(
          body.message ?? 'The dip could not be saved. Check the litres and try again.',
        );
      }
      setDipOpen(false);
      toast.success('Dip saved. It has been compared with the books below.');
      selectTab('dips');
      router.refresh();
    } catch (error) {
      setDipError(
        error instanceof Error ? error.message : 'The dip could not be saved. Try again.',
      );
    } finally {
      setDipSaving(false);
    }
  }

  async function voidDip(dipId: string) {
    const reason = window
      .prompt('Why is this dip being voided? Use at least five characters.')
      ?.trim();
    if (!reason || reason.length < 5) return;
    if (
      !(await confirm({
        title: 'Void this tank dip?',
        consequence:
          'This removes the dip from stock calculations. It cannot be undone, and a dip attached to a delivery or reconciliation will be refused.',
        confirmLabel: 'Void tank dip',
        tone: 'warning',
      }))
    )
      return;
    setVoidingDipId(dipId);
    setMessage(null);
    try {
      const response = await fetch('/api/inventory/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          commandType: 'VoidTankDip',
          tenantId: context.tenantId,
          stationId: context.stationId,
          dipId,
          reason,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? 'The dip could not be voided.');
      toast.success('Dip voided. It no longer counts in stock calculations.');
      router.refresh();
    } catch (error) {
      setMessage({
        tone: 'critical',
        text: error instanceof Error ? error.message : 'The dip could not be voided.',
      });
    } finally {
      setVoidingDipId(null);
    }
  }

  async function saveLimits(event: FormEvent) {
    event.preventDefault();
    await saveLimitsRequest();
  }

  async function saveLimitsRequest() {
    setMessage(null);
    const yellowText = yellow.trim();
    const redText = red.trim();
    if (yellowText && !LITRES.test(yellowText)) {
      return setMessage({
        tone: 'critical',
        text: 'Enter the yellow limit in litres, for example 20.',
      });
    }
    if (redText && !LITRES.test(redText)) {
      return setMessage({
        tone: 'critical',
        text: 'Enter the red limit in litres, for example 40.',
      });
    }
    if (redText && !yellowText) {
      return setMessage({ tone: 'critical', text: 'Set the yellow limit before the red one.' });
    }
    if (redText && Number(redText) < Number(yellowText)) {
      return setMessage({
        tone: 'critical',
        text: 'The red limit cannot be lower than the yellow limit.',
      });
    }
    setSaving(true);
    try {
      const response = await fetch('/api/inventory/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          commandType: 'SetTankVarianceLimits',
          tenantId: context.tenantId,
          stationId: context.stationId,
          tankId: tank.id,
          acceptableVarianceLitres: yellowText || null,
          varianceRedLitres: redText || null,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        code?: string;
      };
      if (response.status === 403 && body.code === 'STEP_UP_REQUIRED') {
        setStepUpRetry('limits');
        return;
      }
      if (!response.ok) throw new Error(body.message ?? 'The limits could not be saved.');
      toast.success('Limits saved. New dips will be judged against them.');
      router.refresh();
    } catch (error) {
      setMessage({
        tone: 'critical',
        text: error instanceof Error ? error.message : 'The limits could not be saved.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function importChartFile(file: File | undefined) {
    if (!file) return;
    setChartMessage(null);
    setChartText(await file.text());
  }

  async function saveChart(event: FormEvent) {
    event.preventDefault();
    await saveChartRequest();
  }

  async function saveChartRequest() {
    setChartMessage(null);
    setChartSaving(true);
    try {
      const points = parseCalibrationText(chartText);
      const response = await fetch('/api/inventory/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          commandType: 'SetTankCalibration',
          tenantId: context.tenantId,
          stationId: context.stationId,
          tankId: tank.id,
          measurementUnit: chartUnit.trim(),
          points,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        code?: string;
      };
      if (response.status === 403 && body.code === 'STEP_UP_REQUIRED') {
        setStepUpRetry('chart');
        return;
      }
      if (!response.ok) throw new Error(body.message ?? 'The chart could not be saved.');
      toast.success(`Chart saved with ${points.length} rows. New dips will use it.`);
      setChartText('');
      router.refresh();
    } catch (error) {
      setChartMessage({
        tone: 'critical',
        text: error instanceof Error ? error.message : 'The chart could not be saved.',
      });
    } finally {
      setChartSaving(false);
    }
  }

  const percent = fillPercent(tank.bookLitres, tank.capacityLitres);
  const lastDip = dips[0];
  const lastSignal = lastDip ? SIGNAL[lastDip.signal] : null;
  const balances = runningBalances(movements, tank.bookLitres);

  return (
    <div className="stack stack-lg tank-page">
      <PageHeader
        eyebrow={`${context.stationName} · ${tank.productName}`}
        title={`Tank ${tank.code}`}
        actions={
          <>
            <Link className="button button-quiet" href={streamHref}>
              Cost history
            </Link>
            <Link className="button button-quiet" href={inventoryHref}>
              Back to inventory
            </Link>
          </>
        }
      />

      <Card className="tank-hero" data-tone={lastSignal?.tone ?? 'neutral'}>
        <div className="tank-hero-main">
          <p className="tank-hero-label">In the tank now, by the books</p>
          <p className="tank-hero-figure">
            <strong>{formatLitres(tank.bookLitres)}</strong>
            <span> of {formatLitres(tank.capacityLitres)}</span>
          </p>
          <div
            className="tank-bar"
            role="img"
            aria-label={percent === null ? 'Level not known' : `${percent} percent full`}
          >
            <span style={{ width: `${percent ?? 0}%` }} />
          </div>
          <p className="tank-hero-note">
            {percent === null ? 'Level not known. ' : `${percent}% full. `}
            {lastDip && lastSignal
              ? `Last checked ${stationDateTime(lastDip.measuredAt, stationTimezone)}: ${lastSignal.short}.`
              : 'No dip has been recorded yet. Record one to check the books against the tank.'}
          </p>
        </div>
        <div className="tank-hero-side">
          <dl className="tank-hero-stats">
            <div>
              <dt>Last measured</dt>
              <dd>{lastDip ? formatLitres(lastDip.physicalLitres) : '—'}</dd>
            </div>
            <div className="tank-hero-diff">
              <dt>Difference</dt>
              <dd>{lastDip ? signed(lastDip.varianceLitres) : '—'}</dd>
            </div>
          </dl>
          {canManage ? (
            <Button type="button" onClick={() => setDipOpen(true)}>
              Record a dip
            </Button>
          ) : null}
        </div>
      </Card>

      <div className="tank-tabs" role="tablist" aria-label="Tank details">
        {availableTabs.map((item) => (
          <button
            key={item.value}
            id={`tank-tab-${item.value}`}
            type="button"
            role="tab"
            aria-selected={tab === item.value}
            aria-controls="tank-tabpanel"
            onClick={() => selectTab(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div id="tank-tabpanel" role="tabpanel" aria-labelledby={`tank-tab-${tab}`}>
        {tab === 'dips' ? (
          <Card className="form-panel">
            <h2>Dips and how they compared</h2>
            {dips.length === 0 ? (
              <EmptyState
                title="No dips yet"
                message={
                  canManage
                    ? 'Press Record a dip to measure this tank and compare it with the books.'
                    : 'Dips recorded for this tank will show here.'
                }
              />
            ) : (
              <ul className="tank-timeline">
                {dips.map((dip) => (
                  <li key={dip.id}>
                    <div>
                      <strong>{formatLitres(dip.physicalLitres)} measured</strong>
                      <span className="table-secondary">
                        {stationDateTime(dip.measuredAt, stationTimezone)}
                        {dip.rawMeasurement
                          ? ` · ${dip.rawMeasurement} ${dip.measurementUnit ?? ''} on the dipstick`
                          : ''}
                      </span>
                      <span className="table-secondary">
                        {dipSentence(dip.varianceLitres, dip.signal)}
                      </span>
                    </div>
                    <div className="tank-timeline-side">
                      <StatusBadge tone={SIGNAL[dip.signal].tone}>
                        {SIGNAL[dip.signal].label}
                      </StatusBadge>
                      {canManage ? (
                        <Button
                          type="button"
                          variant="quiet"
                          loading={voidingDipId === dip.id}
                          onClick={() => void voidDip(dip.id)}
                        >
                          Void
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {message && tab === 'dips' ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          </Card>
        ) : null}

        {tab === 'movements' ? (
          <Card className="form-panel">
            <h2>Stock movements</h2>
            {movements.length === 0 ? (
              <EmptyState
                title="No movements yet"
                message="Opening stock, deliveries and sales will show here."
              />
            ) : (
              <ul className="tank-timeline">
                {movements.map((movement, index) => {
                  const quantity = Number(movement.quantityLitres);
                  return (
                    <li key={movement.id}>
                      <div>
                        <strong>
                          {MOVEMENT_LABELS[movement.movementType] ?? movement.movementType}
                        </strong>
                        <span className="table-secondary">
                          {stationDateTime(movement.effectiveAt, stationTimezone)} ·{' '}
                          {formatBusinessDate(movement.businessDate)}
                        </span>
                      </div>
                      <div className="tank-timeline-side tank-movement-side">
                        <strong data-direction={quantity < 0 ? 'out' : 'in'}>
                          {signed(movement.quantityLitres)}
                        </strong>
                        <span className="table-secondary">
                          Stock after: {formatLitres(balances[index]!)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        ) : null}

        {tab === 'settings' && canManage ? (
          <div className="tank-settings-grid">
            <Card className="form-panel">
              <h2>When a difference matters</h2>
              <p className="table-secondary">
                A dip is compared with the books. Within the yellow limit it is fine. Above yellow
                it must be explained. Above red it is urgent. Leave red empty to use twice the
                yellow limit.
              </p>
              <form className="form-stack" onSubmit={saveLimits}>
                <Field id="tank-yellow" label="Yellow: explain above (litres)" optional>
                  <input
                    id="tank-yellow"
                    inputMode="decimal"
                    value={yellow}
                    onChange={(event) => setYellow(event.target.value)}
                  />
                </Field>
                <Field id="tank-red" label="Red: urgent above (litres)" optional>
                  <input
                    id="tank-red"
                    inputMode="decimal"
                    value={red}
                    onChange={(event) => setRed(event.target.value)}
                  />
                </Field>
                <Button type="submit" loading={saving}>
                  Save limits
                </Button>
              </form>
              {message && tab === 'settings' ? (
                <Notice tone={message.tone}>{message.text}</Notice>
              ) : null}
            </Card>

            <Card className="form-panel">
              <h2>Dipstick chart</h2>
              <p className="table-secondary">
                The tank maker&apos;s chart turns a dipstick reading into litres. Type or paste the
                rows, or import a CSV file with the reading and the litres on each line. A new chart
                is used for new dips; dips already recorded keep their litres.
              </p>
              {chart ? (
                <TableScrollRegion label={`Dipstick chart for tank ${tank.code}`}>
                  <table className="data-table">
                    <caption className="visually-hidden">
                      Dipstick chart for tank {tank.code}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Reading ({chart.unit})</th>
                        <th scope="col">Litres</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chart.rows.map((row) => (
                        <tr key={row.measurement}>
                          <th scope="row">{row.measurement}</th>
                          <td data-label="Litres" className="numeric">
                            {formatLitres(row.litres)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScrollRegion>
              ) : (
                <p className="table-secondary">
                  No chart yet. Dips are typed in litres until one is saved.
                </p>
              )}
              <form className="form-stack" onSubmit={saveChart}>
                <Field id="chart-unit" label="Readings are in" required>
                  <select
                    id="chart-unit"
                    value={chartUnit}
                    onChange={(event) => setChartUnit(event.target.value)}
                  >
                    <option value="mm">mm</option>
                    <option value="cm">cm</option>
                    <option value="inches">inches</option>
                  </select>
                </Field>
                <Field id="chart-file" label="Import a CSV file" optional>
                  <input
                    id="chart-file"
                    type="file"
                    accept=".csv,text/csv,text/plain"
                    onChange={(event) => void importChartFile(event.target.files?.[0])}
                  />
                </Field>
                <Field
                  id="chart-rows"
                  label="Chart rows"
                  hint="One row per line: the reading, then the litres. For example 1125, 18400."
                  required
                >
                  <textarea
                    id="chart-rows"
                    rows={6}
                    value={chartText}
                    onChange={(event) => setChartText(event.target.value)}
                    placeholder={'0, 0\n500, 9200\n1000, 18400'}
                  />
                </Field>
                <Button type="submit" loading={chartSaving}>
                  Save chart
                </Button>
                {chartMessage ? (
                  <Notice tone={chartMessage.tone}>{chartMessage.text}</Notice>
                ) : null}
              </form>
            </Card>
          </div>
        ) : null}
      </div>

      <Modal
        open={dipOpen}
        onClose={() => setDipOpen(false)}
        title="Record a dip"
        description="Measure the tank and enter the litres. The books' figure is filled in for you; change it to what you measured."
        dismissible={!dipSaving}
      >
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void recordDip();
          }}
        >
          <Field id="dip-litres" label="Litres in the tank" required>
            <input
              id="dip-litres"
              inputMode="decimal"
              value={dipLitres}
              onChange={(event) => setDipLitres(event.target.value)}
              required
            />
          </Field>
          {dipError ? (
            <p className="field-error" role="alert">
              {dipError}
            </p>
          ) : null}
          <div className="form-actions">
            <Button type="submit" variant="primary" loading={dipSaving}>
              Save dip
            </Button>
          </div>
        </form>
      </Modal>

      <StepUpDialog
        open={stepUpRetry !== null}
        tenantId={context.tenantId}
        description="Saving this tank setting needs a fresh identity check. Nothing is saved until you confirm."
        confirmLabel="Confirm and save"
        onCancel={() => setStepUpRetry(null)}
        onVerified={() => {
          const retry = stepUpRetry;
          setStepUpRetry(null);
          if (retry === 'limits') void saveLimitsRequest();
          if (retry === 'chart') void saveChartRequest();
        }}
      />
    </div>
  );
}
