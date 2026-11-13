'use client';

import { useEffect, useState } from 'react';
import { Button, NumericInput, type StatusTone } from '@/design-system/primitives';
import { formatLitres, formatTimeInTimeZone } from '@/design-system/formatters';
import { classifyStockVariance } from '../../approvals/operations-alerts';
import type { RecordData } from '../daily-operations-read-model';
import { dipInstantForSheet } from '../dip-time';
import { PumpReadout } from './pump-readout';

type Tank = RecordData['tanks'][number];

const SIGNAL: Record<ReturnType<typeof classifyStockVariance>, [StatusTone, string]> = {
  ok: ['positive', 'Within the allowed difference'],
  watch: ['warning', 'Needs an explanation'],
  alert: ['critical', 'Needs urgent attention'],
  unjudged: ['neutral', 'Not checked yet'],
};

/** What a saved dip means, in plain words: how far it is from what was expected, and whether that is fine. */
function savedSentence(variance: string | null, label: string, noLimit: boolean): string {
  if (variance === null) return '';
  if (Number(variance) === 0) return 'It matches what was expected.';
  const direction = variance.startsWith('-') ? 'below' : 'above';
  const amount = formatLitres(variance.replace(/^-/, ''));
  return `${amount} ${direction} expected${noLimit ? '.' : ` — ${label.toLowerCase()}.`}`;
}

function newKey(tankId: string) {
  return `ui-tank-dip-${tankId}-${crypto.randomUUID()}`;
}

/**
 * Every tank at the station, in the order of the paper form, whether or not it has a dip yet. A
 * supervisor types the dipstick reading in millimetres and the litres come from the tank's chart;
 * where a tank has no millimetre chart, the litres are typed in. A new dip replaces that tank's
 * earlier dip on this day's sheet.
 */
export function DailyTankDips({
  tenantId,
  stationId,
  timezone,
  reconciliationId,
  record,
  editable,
  onChanged,
  onUnsavedChange,
}: Readonly<{
  tenantId: string;
  stationId: string;
  timezone: string;
  reconciliationId: string;
  record: RecordData;
  editable: boolean;
  onChanged: () => Promise<void>;
  /** The fuels whose typed dip has not been saved yet, so the step can ask for it before moving on. */
  onUnsavedChange?: (fuels: string[]) => void;
}>) {
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [busyTank, setBusyTank] = useState<string | null>(null);
  const [savedTanks, setSavedTanks] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  function setTankError(tankId: string, text: string | null) {
    setErrors((current) => {
      const { [tankId]: _old, ...rest } = current;
      return text ? { ...rest, [tankId]: text } : rest;
    });
  }

  const unsaved = record.tanks
    .filter((tank) => (entries[tank.tankId] ?? '').trim() !== '')
    .map((tank) => tank.productName);
  const unsavedKey = unsaved.join('\u0000');
  useEffect(() => {
    onUnsavedChange?.(unsavedKey ? unsavedKey.split('\u0000') : []);
    return () => onUnsavedChange?.([]);
  }, [unsavedKey, onUnsavedChange]);

  async function post(url: string, key: string, body: Record<string, unknown>) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': key,
        // The tank says what happened, in words, so the general "Saved" toast stays quiet.
        'x-own-confirmation': '1',
      },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => null)) as {
      error?: string;
      message?: string;
      dipId?: string;
    } | null;
    if (!response.ok) throw new Error(result?.message ?? 'The dip could not be saved.');
    return result ?? {};
  }

  async function save(tank: Tank) {
    const reading = (entries[tank.tankId] ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(reading)) {
      setTankError(
        tank.tankId,
        reading
          ? `Use numbers only, for example ${tank.hasMillimetreChart ? '1450' : '25000'}.`
          : `Enter the ${tank.hasMillimetreChart ? 'dipstick reading in mm' : 'litres in the tank'} first.`,
      );
      return;
    }
    setBusyTank(tank.tankId);
    setTankError(tank.tankId, null);
    try {
      const dip = await post('/api/inventory/commands', newKey(tank.tankId), {
        commandType: 'RecordTankDip',
        tenantId,
        stationId,
        tankId: tank.tankId,
        measuredAt: dipInstantForSheet(new Date(), record.business_date, timezone).toISOString(),
        ...(tank.hasMillimetreChart
          ? { rawMeasurement: reading, measurementUnit: 'mm' }
          : { physicalLitres: reading }),
      });
      if (!dip.dipId) throw new Error('The dip was not saved.');
      const kept = record.dips
        .filter((existing) => existing.tankId !== tank.tankId)
        .map((existing) => {
          const other = record.tanks.find((candidate) => candidate.tankId === existing.tankId);
          return { dipId: existing.dipId, tankId: existing.tankId, productId: other?.productId };
        });
      await post('/api/forecourt/commands', newKey(tank.tankId), {
        commandType: 'LinkTankDips',
        tenantId,
        stationId,
        reconciliationId,
        expectedVersion: record.version,
        dips: [...kept, { dipId: dip.dipId, tankId: tank.tankId, productId: tank.productId }],
      });
      setEntries((current) => {
        const { [tank.tankId]: _saved, ...rest } = current;
        return rest;
      });
      await onChanged();
      setSavedTanks((current) => new Set(current).add(tank.tankId));
      // On to the next tank that still needs a dip, so a round of dips is typed without the mouse.
      const index = record.tanks.findIndex((candidate) => candidate.tankId === tank.tankId);
      const next = record.tanks
        .slice(index + 1)
        .find(
          (candidate) =>
            !record.dips.some((existing) => existing.tankId === candidate.tankId) &&
            !(entries[candidate.tankId] ?? '').trim(),
        );
      if (next) document.getElementById(`dip-${next.tankId}`)?.focus();
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : '';
      const outOfDate = /stale|version/i.test(raw);
      // Bring the sheet up to date so the next press works, without losing what was typed.
      if (outOfDate) await onChanged().catch(() => undefined);
      setTankError(
        tank.tankId,
        outOfDate
          ? 'Someone else changed this sheet, so we refreshed it. Your reading is still here. Press Save dip again.'
          : 'The dip could not be saved. Your reading is still here. Press Save dip to try again.',
      );
    } finally {
      setBusyTank(null);
    }
  }

  if (record.tanks.length === 0) {
    return <p className="muted-small">No tanks are set up for this station yet.</p>;
  }

  return (
    <div className="tank-list">
      {record.tanks.map((tank) => {
        const dip = record.dips.find((entry) => entry.tankId === tank.tankId);
        const variance = record.totals.stockVariance[tank.tankId] ?? null;
        const [tone, label] =
          SIGNAL[
            classifyStockVariance(
              dip ? variance : null,
              tank.toleranceLitres,
              tank.redLitres ?? null,
            )
          ];
        return (
          <article
            key={tank.tankId}
            className="tank-row"
            data-saved={savedTanks.has(tank.tankId) && dip ? '' : undefined}
          >
            <header className="pump-row-head">
              <h3>{tank.productName}</h3>
              {dip?.measuredAt ? (
                <p className="pump-row-meta">
                  Dipped {formatTimeInTimeZone(dip.measuredAt, timezone)}
                </p>
              ) : null}
            </header>
            {dip ? (
              <div className="tank-row-readings" data-with-expected={editable ? undefined : ''}>
                <PumpReadout label="Dip on this sheet" value={formatLitres(dip.physicalLitres)} />
                {editable ? null : (
                  <PumpReadout
                    label="Expected"
                    value={tank.expectedLitres ? formatLitres(tank.expectedLitres) : '—'}
                  />
                )}
                <PumpReadout
                  label="Difference"
                  value={
                    dip && variance !== null
                      ? `${Number(variance) > 0 ? '+' : ''}${formatLitres(variance)}`
                      : '—'
                  }
                  result
                />
                <PumpReadout
                  label="Result"
                  value={
                    <span className="tank-result" data-tone={tone}>
                      {tank.toleranceLitres === null && dip ? 'No allowed difference set' : label}
                    </span>
                  }
                  result
                />
              </div>
            ) : editable ? null : (
              <div className="tank-row-readings">
                <PumpReadout
                  label="Expected"
                  value={tank.expectedLitres ? formatLitres(tank.expectedLitres) : '—'}
                />
              </div>
            )}
            {!dip && !editable ? <p className="muted-small">No dip was recorded.</p> : null}
            {editable ? (
              <div className="tank-row-entry">
                <PumpReadout
                  label="Expected"
                  value={tank.expectedLitres ? formatLitres(tank.expectedLitres) : '—'}
                />
                <NumericInput
                  id={`dip-${tank.tankId}`}
                  label={
                    tank.hasMillimetreChart ? 'New dip (dipstick, mm)' : 'New dip (litres in tank)'
                  }
                  inputMode="decimal"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && busyTank === null) void save(tank);
                  }}
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void save(tank)}
                      disabled={busyTank !== null}
                    >
                      {busyTank === tank.tankId ? 'Saving…' : 'Save dip'}
                    </Button>
                  }
                  value={entries[tank.tankId] ?? ''}
                  error={errors[tank.tankId]}
                  disabled={busyTank === tank.tankId}
                  onChange={(event) => {
                    setTankError(tank.tankId, null);
                    setSavedTanks((current) => {
                      if (!current.has(tank.tankId)) return current;
                      const next = new Set(current);
                      next.delete(tank.tankId);
                      return next;
                    });
                    setEntries((current) => ({
                      ...current,
                      [tank.tankId]: event.target.value,
                    }));
                  }}
                />
              </div>
            ) : null}
            {savedTanks.has(tank.tankId) && dip ? (
              <p className="tank-row-confirm" data-tone={tone} role="status">
                <span aria-hidden="true">✓</span>
                <span>
                  Dip saved. {savedSentence(variance, label, tank.toleranceLitres === null)}
                </span>
              </p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
