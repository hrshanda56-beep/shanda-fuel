'use client';

import { useState } from 'react';
import { Button, NumericInput, StatusBadge, type StatusTone } from '@/design-system/primitives';
import { TableScrollRegion } from '@/design-system/table';
import { formatLitres } from '@/design-system/formatters';
import { classifyStockVariance } from '../../approvals/operations-alerts';
import type { RecordData } from '../daily-operations-read-model';
import { dipInstantForSheet } from '../dip-time';

type Tank = RecordData['tanks'][number];

const SIGNAL: Record<ReturnType<typeof classifyStockVariance>, [StatusTone, string]> = {
  ok: ['positive', 'Within the allowed difference'],
  watch: ['warning', 'Needs an explanation'],
  alert: ['critical', 'Needs urgent attention'],
  unjudged: ['neutral', 'Not checked yet'],
};

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
}: Readonly<{
  tenantId: string;
  stationId: string;
  timezone: string;
  reconciliationId: string;
  record: RecordData;
  editable: boolean;
  onChanged: () => Promise<void>;
}>) {
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [busyTank, setBusyTank] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(url: string, key: string, body: Record<string, unknown>) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
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
      setError(
        `Enter the ${tank.hasMillimetreChart ? 'dipstick reading' : 'litres'} for tank ${tank.code} as a number.`,
      );
      return;
    }
    setBusyTank(tank.tankId);
    setError(null);
    setMessage(null);
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
      setEntries((current) => ({ ...current, [tank.tankId]: '' }));
      setMessage(`Tank ${tank.code} dip saved.`);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The dip could not be saved.');
    } finally {
      setBusyTank(null);
    }
  }

  if (record.tanks.length === 0) {
    return <p className="muted-small">No tanks are set up for this station yet.</p>;
  }

  return (
    <div>
      <TableScrollRegion label="Tank dips for this day">
        <table className="responsive-table">
          <caption className="visually-hidden">Tank dips for this day</caption>
          <thead>
            <tr>
              <th scope="col">Tank</th>
              <th scope="col">Fuel</th>
              <th scope="col">Dip on this sheet</th>
              <th scope="col">Compared with the books</th>
              {editable ? <th scope="col">New dip</th> : null}
            </tr>
          </thead>
          <tbody>
            {record.tanks.map((tank) => {
              const dip = record.dips.find((entry) => entry.tankId === tank.tankId);
              const variance = record.totals.stockVariance[tank.tankId] ?? null;
              const [tone, label] =
                SIGNAL[classifyStockVariance(dip ? variance : null, tank.toleranceLitres)];
              return (
                <tr key={tank.tankId}>
                  <th scope="row" data-label="Tank">
                    {tank.code}
                  </th>
                  <td data-label="Fuel">{tank.productName}</td>
                  <td data-label="Dip on this sheet" className="numeric">
                    {dip ? `${formatLitres(dip.physicalLitres)} L` : 'No dip yet'}
                  </td>
                  <td data-label="Compared with the books">
                    {dip && variance !== null ? (
                      <>
                        <span className="numeric">
                          {Number(variance) > 0 ? '+' : ''}
                          {formatLitres(variance)} L
                        </span>{' '}
                      </>
                    ) : null}
                    <StatusBadge tone={tone}>
                      {tank.toleranceLitres === null && dip ? 'No allowed difference set' : label}
                    </StatusBadge>
                  </td>
                  {editable ? (
                    <td data-label="New dip">
                      <NumericInput
                        id={`dip-${tank.tankId}`}
                        label={tank.hasMillimetreChart ? 'Dipstick (mm)' : 'Litres in tank'}
                        inputMode="decimal"
                        value={entries[tank.tankId] ?? ''}
                        onChange={(event) =>
                          setEntries((current) => ({
                            ...current,
                            [tank.tankId]: event.target.value,
                          }))
                        }
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void save(tank)}
                        disabled={busyTank !== null}
                      >
                        {busyTank === tank.tankId ? 'Saving…' : 'Save dip'}
                      </Button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScrollRegion>
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
