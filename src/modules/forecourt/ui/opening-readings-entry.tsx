'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useToast } from '../../../design-system/feedback-provider';
import { Modal } from '../../../design-system/modal';
import { Button, Card, NumericInput } from '../../../design-system/primitives';
import { dailyOperationsProblem } from './daily-operations-state';

type Pump = Readonly<{
  nozzleId: string;
  pumpNumber: string;
  nozzleNumber: string;
  productId: string;
  productName: string;
  sellingPriceId: string | null;
  previousReading: string | null;
}>;

type Props = Readonly<{
  tenantId: string;
  stationId: string;
  shiftId: string;
  reconciliationId: string;
  version: number;
  pumps: ReadonlyArray<Pump>;
}>;

/**
 * Shown right after a shift opens: one number per pump and one button, nothing else. The saved
 * opening readings are what the figures screen later shows, locked, beside the closing readings.
 */
export function OpeningReadingsEntry({
  tenantId,
  stationId,
  shiftId,
  reconciliationId,
  version,
  pumps,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(true);
  const sorted = [...pumps].sort((a, b) =>
    `${a.pumpNumber}.${a.nozzleNumber}`.localeCompare(
      `${b.pumpNumber}.${b.nozzleNumber}`,
      undefined,
      {
        numeric: true,
      },
    ),
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(sorted.map((pump) => [pump.nozzleId, pump.previousReading ?? ''])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    const missing = sorted.find((pump) => !values[pump.nozzleId]?.trim());
    if (missing) {
      setError(
        `Enter the opening reading for pump ${missing.pumpNumber}, nozzle ${missing.nozzleNumber}.`,
      );
      return;
    }
    const unpriced = sorted.find((pump) => !pump.sellingPriceId);
    if (unpriced) {
      setError(
        `${unpriced.productName} has no selling price yet. Ask a manager to set it, then come back.`,
      );
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch('/api/forecourt/commands', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `opening-readings-${reconciliationId}-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          commandType: 'SaveMeterReadings',
          tenantId,
          stationId,
          reconciliationId,
          expectedVersion: version,
          // The closing reading is not known yet; it is filled in when the figures are entered.
          readings: sorted.map((pump) => {
            const opening = values[pump.nozzleId]!.trim();
            return {
              nozzleId: pump.nozzleId,
              productId: pump.productId,
              shiftId,
              openingReading: opening,
              closingReading: opening,
              sellingPriceId: pump.sellingPriceId,
            };
          }),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
          code?: string;
        };
        setError(dailyOperationsProblem(response.status, body.code, body.message).message);
        return;
      }
      setOpen(false);
      toast.success('Opening readings saved. You can now enter the figures for this shift.');
      router.push(`/operations/daily?${new URLSearchParams({ tenantId, stationId }).toString()}`);
      router.refresh();
    } catch {
      setError('The readings could not be saved. Check your connection and press Save again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="daily-operations-workspace" aria-label="Opening readings">
      <Card as="section" className="card panel cash-panel" aria-labelledby="opening-readings-title">
        <p className="eyebrow">Shift opened</p>
        <h2 id="opening-readings-title">Opening readings needed</h2>
        <p className="panel-detail">Enter what each pump meter shows now to start the shift.</p>
        <div className="form-actions">
          <Button variant="primary" onClick={() => setOpen(true)}>
            Enter opening readings
          </Button>
        </div>
      </Card>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Opening readings"
        description="Enter what each pump meter shows now."
        dismissible={!busy}
      >
        <form
          className="meter-list"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {sorted.map((pump) => (
            <article className="meter-card" key={pump.nozzleId}>
              <div className="meter-card-heading">
                <div>
                  <span className="eyebrow">
                    Pump {pump.pumpNumber} · Nozzle {pump.nozzleNumber}
                  </span>
                  <h3>{pump.productName}</h3>
                </div>
              </div>
              <NumericInput
                id={`opening-${pump.nozzleId}`}
                label="Opening"
                value={values[pump.nozzleId] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [pump.nozzleId]: event.target.value }))
                }
                unit="L"
                required
              />
            </article>
          ))}
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form-actions">
            <Button type="submit" variant="primary" loading={busy}>
              Save opening readings
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
