'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type RefObject, useMemo, useRef, useState } from 'react';

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
import { useLocationSearch } from './location-search';

type FallbackShellContext = Readonly<{
  organisation: string;
  station: string;
  businessDate: string;
  shift?: string;
}>;

type ContextSelectorProps = Readonly<{
  fallback?: FallbackShellContext;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** Reports the current context parts (organisation → station) as they resolve. */
  onLabelChange?: (label: { station: string; parts: readonly string[] }) => void;
}>;

type SelectorState =
  | { status: 'loading'; resolution?: undefined; error?: undefined }
  | { status: 'ready'; resolution: ContextResolution; error?: undefined }
  | { status: 'error'; resolution?: undefined; error: string };

export function ContextSelector({
  fallback,
  open,
  onOpen,
  onClose,
  onLabelChange,
}: ContextSelectorProps) {
  const pathname = usePathname() ?? '/';
  const search = useLocationSearch();
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<SelectorState>({ status: 'loading' });
  const [refresh, setRefresh] = useState(0);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
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

  const fullLabel = currentLabel.join(', ');
  // The resolved context ends with its station (or "All stations"); the
  // preview fallback ends with a date and shift, so it names its station.
  const pillLabel =
    state.status !== 'ready' && fallback
      ? fallback.station
      : (currentLabel[currentLabel.length - 1] ?? 'Work context');

  useEffect(() => {
    onLabelChange?.({ station: pillLabel, parts: currentLabel });
  }, [currentLabel, onLabelChange, pillLabel]);

  function retry() {
    setState({ status: 'loading' });
    setRefresh((value) => value + 1);
  }

  async function submit(selection: ContextSelection, key: string) {
    setPendingKey(key);
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
      setPendingKey(null);
    }
  }

  return (
    <div className="shell-context-selector">
      <p
        id="shell-context-current"
        className="shell-context visually-hidden"
        role="group"
        aria-label="Work context"
      >
        {currentLabel.map((part, index) => (
          <span key={`${part}-${index}`} className="shell-context-part">
            {part}
          </span>
        ))}
      </p>
      <button
        ref={triggerRef}
        type="button"
        className="shell-context-pill"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Work context: ${fullLabel}. Change work context`}
        title={fullLabel}
        onClick={onOpen}
      >
        <span className="shell-context-pill-label">{pillLabel}</span>
        <Icon name="chevron-down" size="sm" />
      </button>

      <Modal
        open={open}
        onClose={onClose}
        title="Switch station"
        description="Tap where you are working. It applies straight away."
        size="md"
        className="modal-context"
        initialFocusRef={formRef}
        returnFocus={() => triggerRef.current}
        dismissible={!submitting}
      >
        {state.status === 'loading' ? <ContextLoading /> : null}
        {state.status === 'error' ? <ContextError message={state.error} onRetry={retry} /> : null}
        {state.status === 'ready' && state.resolution.available.organisations.length === 0 ? (
          <ContextEmpty />
        ) : null}
        {state.status === 'ready' &&
        state.resolution.current &&
        state.resolution.available.organisations.length > 0 ? (
          <ContextForm
            available={state.resolution.available}
            policy={state.resolution.route.policy}
            current={state.resolution.current}
            submitting={submitting}
            pendingKey={pendingKey}
            submitError={submitError}
            onSelect={submit}
            formRef={formRef}
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
  current,
  submitting,
  pendingKey,
  submitError,
  onSelect,
  formRef,
}: {
  formRef: RefObject<HTMLDivElement | null>;
  available: AvailableContext;
  policy: ContextResolution['route']['policy'];
  current: CurrentContext;
  submitting: boolean;
  pendingKey: string | null;
  submitError: string | null;
  onSelect: (selection: ContextSelection, key: string) => void;
}) {
  const [organisationId, setOrganisationId] = useState(current.organisationId);
  const organisation =
    available.organisations.find((candidate) => candidate.id === organisationId) ??
    available.organisations[0];
  if (!organisation) return null;

  const legalEntities = organisation.legalEntities;
  const showEntityHeadings = legalEntities.length > 1;
  const hasStations = legalEntities.some((entity) => entity.stations.length > 0);
  const inCurrentOrganisation = organisation.id === current.organisationId;
  // With the legal entity optional, one "all stations" row covers the organisation;
  // when it is required, "all stations" belongs to each legal entity.
  const allPerEntity = policy.allStationsAllowed && policy.legalEntity === 'required';
  const allForOrganisation = policy.allStationsAllowed && policy.legalEntity === 'optional';

  return (
    <div className="context-selector-form" ref={formRef} tabIndex={-1}>
      {available.organisations.length > 1 ? (
        <div className="context-selector-orgs" role="group" aria-label="Organisation">
          {available.organisations.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className="context-selector-org"
              aria-pressed={candidate.id === organisation.id}
              disabled={submitting}
              onClick={() => setOrganisationId(candidate.id)}
            >
              {candidate.name}
            </button>
          ))}
        </div>
      ) : null}

      {allForOrganisation ? (
        <ul className="context-selector-list">
          <ContextOption
            title="All stations"
            detail={organisation.name}
            selected={inCurrentOrganisation && current.allStations}
            pending={pendingKey === 'all'}
            disabled={submitting}
            onSelect={() => onSelect({ organisationId: organisation.id, allStations: true }, 'all')}
          />
        </ul>
      ) : null}

      {legalEntities.map((entity) => {
        const entityCurrent = inCurrentOrganisation && current.legalEntityId === entity.id;
        return (
          <section key={entity.id} className="context-selector-group">
            {showEntityHeadings ? <h3>{entity.name}</h3> : null}
            <ul className="context-selector-list">
              {allPerEntity ? (
                <ContextOption
                  title="All stations"
                  detail={showEntityHeadings ? undefined : entity.name}
                  selected={entityCurrent && current.allStations}
                  pending={pendingKey === `all:${entity.id}`}
                  disabled={submitting}
                  onSelect={() =>
                    onSelect(
                      {
                        organisationId: organisation.id,
                        legalEntityId: entity.id,
                        allStations: true,
                      },
                      `all:${entity.id}`,
                    )
                  }
                />
              ) : null}
              {entity.stations.map((station) => (
                <ContextOption
                  key={station.id}
                  title={station.name}
                  detail={showEntityHeadings ? undefined : entity.name}
                  selected={inCurrentOrganisation && current.stationId === station.id}
                  pending={pendingKey === station.id}
                  disabled={submitting}
                  onSelect={() =>
                    onSelect(
                      {
                        organisationId: organisation.id,
                        legalEntityId: entity.id,
                        stationId: station.id,
                        allStations: false,
                      },
                      station.id,
                    )
                  }
                />
              ))}
            </ul>
          </section>
        );
      })}

      {!hasStations && policy.station === 'optional' && policy.legalEntity === 'optional' ? (
        <ul className="context-selector-list">
          <ContextOption
            title={organisation.name}
            detail="No stations set up yet"
            selected={inCurrentOrganisation && !current.stationId && !current.allStations}
            pending={pendingKey === 'organisation'}
            disabled={submitting}
            onSelect={() =>
              onSelect({ organisationId: organisation.id, allStations: false }, 'organisation')
            }
          />
        </ul>
      ) : !hasStations ? (
        <p className="context-selector-note">No stations are available in this organisation.</p>
      ) : null}

      {submitError ? (
        <p className="context-selector-error" role="alert">
          {submitError}
        </p>
      ) : null}
    </div>
  );
}

function ContextOption({
  title,
  detail,
  selected,
  pending,
  disabled,
  onSelect,
}: {
  title: string;
  detail?: string | undefined;
  selected: boolean;
  pending: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="context-selector-option"
        aria-current={selected || undefined}
        data-selected={selected || undefined}
        disabled={disabled}
        onClick={selected ? undefined : onSelect}
      >
        <span className="context-selector-option-text">
          <span className="context-selector-option-title">{title}</span>
          {detail ? <span className="context-selector-option-detail">{detail}</span> : null}
        </span>
        {pending ? (
          <span className="context-selector-spinner" aria-hidden="true" />
        ) : selected ? (
          <>
            <Icon name="check" size="sm" className="context-selector-check" />
            <span className="visually-hidden">Current</span>
          </>
        ) : null}
      </button>
    </li>
  );
}

function contextDisplay(
  available: AvailableContext | undefined,
  current: CurrentContext | null,
  fallback?: FallbackShellContext,
): string[] {
  if (!available || !current) {
    return fallback
      ? [fallback.organisation, fallback.station, fallback.businessDate, fallback.shift].filter(
          (part): part is string => Boolean(part),
        )
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
    organisation?.name ?? 'Organisation',
    ...(legalEntity ? [legalEntity.name] : []),
    current.allStations ? 'All stations' : (station?.name ?? 'No station selected'),
  ];
}
