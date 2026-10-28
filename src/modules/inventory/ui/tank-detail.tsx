'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useConfirm } from '@/design-system/feedback-provider';
import { PageHeader } from '@/design-system/layout';
import { Notice } from '@/design-system/feedback';
import { formatBusinessDate, formatLitres } from '@/design-system/formatters';
import { Button, Card, EmptyState, Field, StatusBadge } from '@/design-system/primitives';
import { TableScrollRegion } from '@/design-system/table';
import { StepUpDialog } from '@/modules/setup/ui/step-up-dialog';
import type { StockSignal } from '../../approvals/operations-alerts';
import { parseCalibrationText } from '../calibration';
import type { TankDetail } from '../tank-detail';

const SIGNAL: Record<
  StockSignal,
  { tone: 'positive' | 'warning' | 'critical' | 'neutral'; label: string }
> = {
  ok: { tone: 'positive', label: 'Green: matches the books' },
  watch: { tone: 'warning', label: 'Yellow: explain it' },
  alert: { tone: 'critical', label: 'Red: urgent' },
  unjudged: { tone: 'neutral', label: 'Not checked' },
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
}: Readonly<{
  context: { tenantId: string; stationId: string; stationName: string };
  inventoryHref: string;
  streamHref: string;
  initialData: TankDetail;
}>) {
  const router = useRouter();
  const confirm = useConfirm();
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

  async function voidDip(dipId: string) {
    const reason = window.prompt('Why is this dip being voided? Use at least five characters.')?.trim();
    if (!reason || reason.length < 5) return;
    if (!(await confirm({
      title: 'Void this tank dip?',
      consequence: 'This removes the dip from stock calculations. It cannot be undone, and a dip attached to a delivery or reconciliation will be refused.',
      confirmLabel: 'Void tank dip',
      tone: 'warning',
    }))) return;
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
      setMessage({ tone: 'positive', text: 'The dip was voided and removed from stock calculations.' });
      router.refresh();
    } catch (error) {
      setMessage({ tone: 'critical', text: error instanceof Error ? error.message : 'The dip could not be voided.' });
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
      setMessage({ tone: 'positive', text: 'The limits were saved.' });
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
      setChartMessage({
        tone: 'positive',
        text: `Chart saved with ${points.length} rows. New dips will use it.`,
      });
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

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow={`${context.stationName} · ${tank.productName}`}
        title={`Tank ${tank.code}`}
        description={`Holds ${formatLitres(tank.capacityLitres)}. The books say ${formatLitres(tank.bookLitres)} is in it now.`}
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

      <Card className="form-panel">
        <h2>When a difference matters</h2>
        <p className="table-secondary">
          A dip is compared with the books. Within the yellow limit it is fine. Above yellow it must
          be explained. Above red it is urgent. Leave red empty to use twice the yellow limit.
        </p>
        {canManage ? (
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
        ) : (
          <p>
            Yellow above {tank.yellowLitres ? formatLitres(tank.yellowLitres) : 'not set'}. Red
            above{' '}
            {tank.redLitres
              ? formatLitres(tank.redLitres)
              : tank.yellowLitres
                ? `${formatLitres(String(Number(tank.yellowLitres) * 2))} (twice yellow)`
                : 'not set'}
            .
          </p>
        )}
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      </Card>

      <Card className="form-panel">
        <h2>Dipstick chart</h2>
        <p className="table-secondary">
          The tank maker&apos;s chart turns a dipstick reading into litres. Type or paste the rows,
          or import a CSV file with the reading and the litres on each line. A new chart is used for
          new dips; dips already recorded keep their litres.
        </p>
        {chart ? (
          <TableScrollRegion label={`Dipstick chart for tank ${tank.code}`}>
            <table className="data-table">
              <caption className="visually-hidden">Dipstick chart for tank {tank.code}</caption>
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
        {canManage ? (
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
            {chartMessage ? <Notice tone={chartMessage.tone}>{chartMessage.text}</Notice> : null}
          </form>
        ) : null}
      </Card>

      <Card className="form-panel">
        <h2>Dips and how they compared</h2>
        {dips.length === 0 ? (
          <EmptyState title="No dips yet" message="Dips recorded for this tank will show here." />
        ) : (
          <TableScrollRegion label={`Dips for tank ${tank.code}`}>
            <table className="data-table">
              <caption className="visually-hidden">Dips for tank {tank.code}</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Measured</th>
                  <th scope="col">Books said</th>
                  <th scope="col">Difference</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {dips.map((dip) => (
                  <tr key={dip.id}>
                    <th scope="row">
                      {stationDateTime(dip.measuredAt, stationTimezone)}
                      {dip.rawMeasurement ? (
                        <span className="table-secondary">
                          {dip.rawMeasurement} {dip.measurementUnit ?? ''} on the dipstick
                        </span>
                      ) : null}
                    </th>
                    <td data-label="Measured" className="numeric">
                      {formatLitres(dip.physicalLitres)}
                    </td>
                    <td data-label="Books said" className="numeric">
                      {formatLitres(dip.bookLitres)}
                    </td>
                    <td data-label="Difference" className="numeric">
                      {signed(dip.varianceLitres)}
                    </td>
                    <td data-label="Result">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollRegion>
        )}
      </Card>

      <Card className="form-panel">
        <h2>Stock movements</h2>
        {movements.length === 0 ? (
          <EmptyState
            title="No movements yet"
            message="Opening stock, deliveries and sales will show here."
          />
        ) : (
          <TableScrollRegion label={`Movements for tank ${tank.code}`}>
            <table className="data-table">
              <caption className="visually-hidden">Movements for tank {tank.code}</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">What</th>
                  <th scope="col">Litres</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => (
                  <tr key={movement.id}>
                    <th scope="row">
                      {stationDateTime(movement.effectiveAt, stationTimezone)}
                      <span className="table-secondary">
                        {formatBusinessDate(movement.businessDate)}
                      </span>
                    </th>
                    <td data-label="What">
                      {MOVEMENT_LABELS[movement.movementType] ?? movement.movementType}
                    </td>
                    <td data-label="Litres" className="numeric">
                      {signed(movement.quantityLitres)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollRegion>
        )}
      </Card>

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
