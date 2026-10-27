'use client';

import { useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '../primitives';

import type { AllStationsOption, WorkplaceOption } from './entry-logic';

const DEFAULT_STATION_COUNTDOWN_SECONDS = 10;

/** Several accessible stations: one tap on a whole row picks it. */
export function WorkplacePicker({
  options,
  allStationsOptions,
  defaultStationId,
}: {
  options: readonly WorkplaceOption[];
  allStationsOptions: readonly AllStationsOption[];
  defaultAllStationsOrganisationId: string;
  defaultStationId: string;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(DEFAULT_STATION_COUNTDOWN_SECONDS);
  const pendingRef = useRef(false);
  const selectionStartedRef = useRef(false);

  const choose = useCallback(
    async (selection: {
      organisationId: string;
      legalEntityId?: string;
      stationId?: string;
      allStations: boolean;
      pendingId: string;
    }) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      selectionStartedRef.current = true;
      setFailed(false);
      setPendingId(selection.pendingId);
      try {
        const response = await fetch('/api/context', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            pathname: '/',
            selection: {
              organisationId: selection.organisationId,
              ...(selection.legalEntityId ? { legalEntityId: selection.legalEntityId } : {}),
              ...(selection.stationId ? { stationId: selection.stationId } : {}),
              allStations: selection.allStations,
            },
          }),
        });
        if (!response.ok) throw new Error('context');
        router.push('/?welcome=1');
      } catch {
        setFailed(true);
        setPendingId(undefined);
        pendingRef.current = false;
      }
    },
    [router],
  );

  const defaultStation = options.find((option) => option.stationId === defaultStationId);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (selectionStartedRef.current) return;
      setSecondsRemaining((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (secondsRemaining !== 0 || selectionStartedRef.current) return;
    if (!defaultStation) return;
    const timer = window.setTimeout(() => {
      void choose({
        organisationId: defaultStation.organisationId,
        legalEntityId: defaultStation.legalEntityId,
        stationId: defaultStation.stationId,
        allStations: false,
        pendingId: defaultStation.stationId,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [choose, secondsRemaining, defaultStation]);

  return (
    <section aria-labelledby="entry-title">
      <header className="entry-heading">
        <h1 id="entry-title">Where are you working today?</h1>
        <p aria-live="polite" role="status">
          {failed
            ? 'Choose an option to try again.'
            : pendingId
              ? 'Opening your dashboard…'
              : `Opening ${defaultStation?.stationName ?? 'your station'} in ${secondsRemaining} seconds unless you choose another.`}
        </p>
      </header>
      <ul className="entry-choices">
        {[...options]
          .sort(
            (x, y) =>
              Number(y.stationId === defaultStationId) - Number(x.stationId === defaultStationId),
          )
          .map((option) => (
            <li key={option.stationId}>
              <button
                type="button"
                className="entry-choice"
                disabled={pendingId !== undefined}
                aria-busy={pendingId === option.stationId || undefined}
                onClick={() =>
                  void choose({
                    organisationId: option.organisationId,
                    legalEntityId: option.legalEntityId,
                    stationId: option.stationId,
                    allStations: false,
                    pendingId: option.stationId,
                  })
                }
              >
                <span className="entry-choice-name">{option.stationName}</span>
                {option.stationId === defaultStationId ? (
                  <span className="entry-choice-detail">Opening automatically</span>
                ) : option.detail ? (
                  <span className="entry-choice-detail">{option.detail}</span>
                ) : null}
              </button>
            </li>
          ))}
        {allStationsOptions.map((option) => (
          <li key={`all:${option.organisationId}`}>
            <button
              type="button"
              className="entry-choice"
              disabled={pendingId !== undefined}
              aria-busy={pendingId === `all:${option.organisationId}` || undefined}
              onClick={() =>
                void choose({
                  organisationId: option.organisationId,
                  allStations: true,
                  pendingId: `all:${option.organisationId}`,
                })
              }
            >
              <span className="entry-choice-name">All stations</span>
              {allStationsOptions.length > 1 ? (
                <span className="entry-choice-detail">{option.organisationName}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {failed ? (
        <p className="entry-alert" role="alert">
          We couldn&apos;t open that station. Please try again.
        </p>
      ) : null}
    </section>
  );
}

/** Signed in, but no active membership grants a workplace. */
export function NoWorkplace() {
  const { signOut } = useClerk();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOutFromClerk() {
    setLoading(true);
    setFailed(false);
    try {
      await signOut();
      router.push('/login');
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="entry-title">
      <header className="entry-heading">
        <h1 id="entry-title">You don&apos;t have a workplace yet</h1>
        <p>
          Your account is signed in, but it isn&apos;t linked to a station. Ask your manager to
          check your access.
        </p>
      </header>
      <div className="entry-form">
        <Button
          variant="secondary"
          size="lg"
          block
          loading={loading}
          onClick={() => void signOutFromClerk()}
        >
          Sign out
        </Button>
        {failed ? (
          <p className="entry-alert" role="alert">
            Sign out failed. Please try again.
          </p>
        ) : null}
      </div>
    </section>
  );
}
