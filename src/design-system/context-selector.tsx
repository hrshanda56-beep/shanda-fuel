'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import {
  buildContextHref,
  type AvailableContext,
  type ContextResolution,
  type ContextSelection,
  type CurrentContext,
} from '@/modules/context';
import { Button } from './primitives';
import { Icon } from './icons';
import { Modal } from './modal';

type FallbackShellContext = Readonly<{
  organisation: string;
  station: string;
}>;

type ContextSelectorProps = Readonly<{
  fallback?: FallbackShellContext;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}>;

type SelectorState =
  | { status: 'loading'; resolution?: undefined; error?: undefined }
  | { status: 'ready'; resolution: ContextResolution; error?: undefined }
  | { status: 'error'; resolution?: undefined; error: string };

export function ContextSelector({ fallback, open, onOpen, onClose }: ContextSelectorProps) {
  const pathname = usePathname() ?? '/';
  const search = useLocationSearch();
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<SelectorState>({ status: 'loading' });
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState<ContextSelection | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(search);
    params.set('pathname', pathname);

    fetch(`/api/context?${params.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as {
          data?: ContextResolution;
          message?: string;
        } | null;
        if (!response.ok || !body?.data) {
          throw new Error(body?.message ?? 'The available work context could not be loaded.');
        }
        return body.data;
      })
      .then((resolution) => {
        setState({ status: 'ready', resolution });
        setSelection(resolution.current);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          error: error instanceof Error ? error.message : 'The work context could not be loaded.',
        });
      });

    return () => controller.abort();
  }, [pathname, refresh, search]);

  const currentLabel = useMemo(() => {
    if (state.status === 'loading' && !fallback) return ['Loading work context…'];
    if (state.status === 'error' && !fallback) return ['Work context unavailable'];
    return contextDisplay(
      state.status === 'ready' ? state.resolution.available : undefined,
      state.status === 'ready' ? state.resolution.current : null,
      fallback,
    );
  }, [fallback, state]);
  const singleStation = useMemo(() => {
    if (state.status !== 'ready') return false;
    const stations = state.resolution.available.organisations.flatMap((organisation) =>
      organisation.legalEntities.flatMap((legalEntity) => legalEntity.stations),
    );
    return stations.length === 1;
  }, [state]);
  const showContextControl = state.status !== 'ready' || !singleStation;

  function retry() {
    setState({ status: 'loading' });
    setRefresh((value) => value + 1);
  }

  async function submit() {
    if (!selection) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch('/api/context', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pathname, selection }),
      });
      const body = (await response.json().catch(() => null)) as {
        data?: { current?: ContextSelection };
        message?: string;
      } | null;
      if (!response.ok || !body?.data?.current) {
        throw new Error(body?.message ?? 'That context is no longer available.');
      }
      const nextSelection = body.data.current;
      onClose();
      router.push(buildContextHref(pathname, search, nextSelection));
    } catch (error: unknown) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'The context could not be changed. Nothing changed.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="shell-context-selector">
      <p
        id="shell-context-current"
        className="shell-context"
        role="group"
        aria-label="Work context"
      >
        {currentLabel.map((part, index) => (
          <span key={`${part}-${index}`} className="shell-context-part">
            {part}
          </span>
        ))}
      </p>
      {showContextControl ? (
        <button
          ref={triggerRef}
          type="button"
          className="shell-context-trigger"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Change work context"
          aria-describedby="shell-context-current"
          onClick={onOpen}
        >
          <span className="shell-context-trigger-label">Change</span>
          <Icon name="chevron-down" size="sm" />
        </button>
      ) : null}

      <Modal
        open={open}
        onClose={onClose}
        title="Select work context"
        description="Choose an organisation, legal entity, and station you are authorised to use."
        size="md"
        returnFocus={() => triggerRef.current}
        dismissible={!submitting}
      >
        {state.status === 'loading' ? <ContextLoading /> : null}
        {state.status === 'error' ? <ContextError message={state.error} onRetry={retry} /> : null}
        {state.status === 'ready' && state.resolution.available.organisations.length === 0 ? (
          <ContextEmpty />
        ) : null}
        {state.status === 'ready' && selection ? (
          <ContextForm
            available={state.resolution.available}
            policy={state.resolution.route.policy}
            selection={selection}
            onChange={setSelection}
            submitting={submitting}
            submitError={submitError}
            onSubmit={submit}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function ContextLoading() {
  return (
    <div className="context-selector-state" role="status" aria-live="polite">
      <span className="context-selector-spinner" aria-hidden="true" />
      <p>Loading authorised work context…</p>
    </div>
  );
}

function ContextError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="context-selector-state" role="alert">
      <h3>Context unavailable</h3>
      <p>{message}</p>
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function ContextEmpty() {
  return (
    <div className="context-selector-state" role="status">
      <h3>No authorised work areas</h3>
      <p>No organisation, legal entity, or station is available for this account.</p>
    </div>
  );
}

function ContextForm({
  available,
  policy,
  selection,
  onChange,
  submitting,
  submitError,
  onSubmit,
}: {
  available: AvailableContext;
  policy: ContextResolution['route']['policy'];
  selection: ContextSelection;
  onChange: (selection: ContextSelection) => void;
  submitting: boolean;
  submitError: string | null;
  onSubmit: () => void;
}) {
  const organisation = available.organisations.find(
    (candidate) => candidate.id === selection.organisationId,
  );
  const legalEntities = organisation?.legalEntities ?? [];
  const legalEntity = selection.legalEntityId
    ? legalEntities.find((candidate) => candidate.id === selection.legalEntityId)
    : undefined;
  const stations = legalEntity
    ? legalEntity.stations.map((station) => ({ station, legalEntity }))
    : legalEntities.flatMap((candidate) =>
        candidate.stations.map((station) => ({ station, legalEntity: candidate })),
      );
  const canSubmit =
    Boolean(organisation) &&
    (policy.legalEntity === 'optional' || Boolean(selection.legalEntityId)) &&
    (policy.station !== 'required' || Boolean(selection.stationId));

  function changeOrganisation(organisationId: string) {
    const nextOrganisation = available.organisations.find(
      (candidate) => candidate.id === organisationId,
    );
    const nextLegalEntity = nextOrganisation?.legalEntities[0];
    onChange({
      organisationId,
      ...(policy.legalEntity === 'required' && nextLegalEntity
        ? { legalEntityId: nextLegalEntity.id }
        : {}),
      allStations: policy.allStationsAllowed,
    });
  }

  function changeLegalEntity(value: string) {
    onChange({
      ...selection,
      ...(value ? { legalEntityId: value } : { legalEntityId: undefined }),
      stationId: undefined,
      allStations: policy.allStationsAllowed,
    });
  }

  function changeStation(value: string) {
    if (value === 'all') {
      onChange({ ...selection, stationId: undefined, allStations: true });
      return;
    }
    const match = stations.find(({ station }) => station.id === value);
    onChange({
      ...selection,
      ...(match ? { legalEntityId: match.legalEntity.id } : {}),
      stationId: value || undefined,
      allStations: false,
    });
  }

  return (
    <div className="context-selector-form">
      <div className="context-selector-current" role="status">
        <span className="context-selector-current-label">Current selection</span>
        <strong>{contextDisplay(available, selection).join(' · ')}</strong>
      </div>

      <label className="context-selector-field">
        <span>Organisation</span>
        <select
          value={selection.organisationId}
          onChange={(event) => changeOrganisation(event.target.value)}
          disabled={submitting}
        >
          {available.organisations.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      </label>

      <label className="context-selector-field">
        <span>Legal entity{policy.legalEntity === 'optional' ? ' (optional)' : ''}</span>
        <select
          value={selection.legalEntityId ?? ''}
          onChange={(event) => changeLegalEntity(event.target.value)}
          disabled={submitting || !organisation}
          required={policy.legalEntity === 'required'}
          aria-required={policy.legalEntity === 'required' || undefined}
        >
          {policy.legalEntity === 'optional' ? <option value="">All legal entities</option> : null}
          {legalEntities.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      </label>

      <label className="context-selector-field">
        <span>Station{policy.station === 'optional' ? ' (optional)' : ''}</span>
        <select
          value={selection.allStations ? 'all' : (selection.stationId ?? '')}
          onChange={(event) => changeStation(event.target.value)}
          disabled={submitting || !organisation}
          required={policy.station === 'required'}
          aria-required={policy.station === 'required' || undefined}
        >
          {policy.station === 'required' ? (
            <option value="">Choose an authorised station</option>
          ) : null}
          {policy.allStationsAllowed ? <option value="all">All stations</option> : null}
          {stations.map(({ station, legalEntity: stationLegalEntity }) => (
            <option key={station.id} value={station.id}>
              {policy.legalEntity === 'optional'
                ? `${stationLegalEntity.name} · ${station.name}`
                : station.name}
            </option>
          ))}
        </select>
      </label>

      {submitError ? (
        <p className="context-selector-error" role="alert">
          {submitError}
        </p>
      ) : null}
      <div className="context-selector-actions">
        <Button onClick={onSubmit} loading={submitting} disabled={!canSubmit}>
          Use this context
        </Button>
      </div>
    </div>
  );
}

function contextDisplay(
  available: AvailableContext | undefined,
  current: CurrentContext | null,
  fallback?: FallbackShellContext,
): string[] {
  if (!available || !current) {
    return fallback
      ? [fallback.station, fallback.organisation].filter((part): part is string => Boolean(part))
      : ['No work context selected'];
  }
  const organisation = available.organisations.find(
    (candidate) => candidate.id === current.organisationId,
  );
  const legalEntity = current.legalEntityId
    ? organisation?.legalEntities.find((candidate) => candidate.id === current.legalEntityId)
    : undefined;
  const station = current.stationId
    ? legalEntity?.stations.find((candidate) => candidate.id === current.stationId)
    : undefined;
  return [
    current.allStations ? 'All stations' : (station?.name ?? 'No station selected'),
    [legalEntity?.name, organisation?.name].filter(Boolean).join(' · ') || 'Organisation',
  ];
}

function useLocationSearch(): string {
  return useSyncExternalStore(subscribeToHistory, readLocationSearch, () => '');
}

function subscribeToHistory(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

function readLocationSearch() {
  return window.location.search;
}
