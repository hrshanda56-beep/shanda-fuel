'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
} from '@/design-system/primitives';
import { formatStatusLabel } from '@/design-system/formatters';

type AttendantHomeData = {
  station: { id: string; code: string; name: string; timezone: string };
  businessDay: { id: string; date: string; state: string } | null;
  shift: {
    id: string;
    state: string;
    plannedStartAt: string;
    plannedEndAt: string;
  } | null;
  readings: Array<{
    id: string;
    pumpNumber: string;
    nozzleNumber: string;
    productName: string;
    readingStatus: string;
    readingValue: string | null;
    reason: string;
  }>;
  captureRequired: boolean;
  needsAttention: boolean;
};

export function AttendantHome({ tenantId, stationId }: { tenantId: string; stationId: string }) {
  const [data, setData] = useState<AttendantHomeData | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ tenantId, stationId });
    void fetch(`/api/forecourt/attendant/today?${query.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as AttendantHomeData & { message?: string };
        if (!response.ok) throw new Error(body.message ?? 'Today could not be loaded.');
        setData(body);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : 'Today could not be loaded.');
        }
      });
    return () => controller.abort();
  }, [stationId, tenantId]);

  if (error) {
    return <ErrorState title="Today could not be loaded" message={error} />;
  }
  if (!data) return <LoadingState label="Loading your station and shift" />;

  const shiftLabel = data.shift
    ? `${formatTime(data.shift.plannedStartAt, data.station.timezone)} – ${formatTime(data.shift.plannedEndAt, data.station.timezone)}`
    : 'No shift assigned yet';

  return (
    <div className="attendant-home">
      <div className="page-header">
        <div>
          <p className="eyebrow">My shift</p>
          <h1>Today at {data.station.name}</h1>
          <p className="lede">Your station work, in one place.</p>
        </div>
        <StatusBadge tone={data.shift?.state === 'OPEN' ? 'positive' : 'pending'}>
          {data.shift ? formatStatusLabel(data.shift.state) : 'Not started'}
        </StatusBadge>
      </div>

      <section className="metric-grid" aria-label="My shift summary">
        <Card className="metric-card">
          <span className="metric-label">Station</span>
          <strong className="metric-value">{data.station.code}</strong>
          <span className="metric-meta">{data.station.name}</span>
        </Card>
        <Card className="metric-card">
          <span className="metric-label">Shift time</span>
          <strong className="metric-value">{shiftLabel}</strong>
          <span className="metric-meta">{data.businessDay?.date ?? 'No business day open'}</span>
        </Card>
        <Card className="metric-card">
          <span className="metric-label">Meter readings</span>
          <strong className="metric-value">{data.readings.length}</strong>
          <span className="metric-meta">Readings for your shift</span>
        </Card>
      </section>

      {data.captureRequired ? (
        <Card as="section" className="panel next-action" aria-labelledby="next-action-title">
          <div>
            <p className="eyebrow">Next action</p>
            <h2 id="next-action-title">Capture your opening meter reading</h2>
            <p>
              Record the reading shown on your assigned pump before you start serving customers.
            </p>
          </div>
          <Link className="button button-primary" href="#meter-readings">
            Go to meter readings
          </Link>
        </Card>
      ) : null}

      {data.needsAttention ? (
        <ErrorState
          title="Meter reading needs attention"
          message="A reading for your shift is unavailable. Ask your supervisor before continuing."
        />
      ) : null}

      <Card as="section" className="panel" id="meter-readings" aria-labelledby="meter-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Meter readings</p>
            <h2 id="meter-title">Your assigned readings</h2>
          </div>
          <StatusBadge
            tone={
              data.needsAttention ? 'critical' : data.readings.length > 0 ? 'positive' : 'neutral'
            }
          >
            {data.needsAttention
              ? 'Needs attention'
              : data.readings.length > 0
                ? 'Complete'
                : 'Not due'}
          </StatusBadge>
        </div>
        {data.readings.length > 0 ? (
          <div className="attendant-reading-list">
            {data.readings.map((reading) => (
              <article className="attendant-reading" key={reading.id}>
                <div>
                  <strong>
                    Pump {reading.pumpNumber} · nozzle {reading.nozzleNumber}
                  </strong>
                  <span>{reading.productName}</span>
                </div>
                <div className="attendant-reading-value">
                  <span>{reading.reason.replaceAll('_', ' ')}</span>
                  <strong>{reading.readingValue ?? 'Unavailable'}</strong>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title={data.shift ? 'No reading captured yet' : 'No shift to show'}
            message={
              data.shift
                ? 'When a reading is due, it will appear here with the next action.'
                : 'Your supervisor will assign or open a shift before meter work is due.'
            }
          />
        )}
      </Card>
    </div>
  );
}

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(value));
}
