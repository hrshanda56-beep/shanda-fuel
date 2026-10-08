'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import {
  buildContextHref,
  listContextOptions,
  type AvailableContext,
  type ContextResolution,
  type ContextSelection,
} from '@/modules/context';
import { SignOutButton } from '@/modules/settings/ui/sign-out-button';
import { Button, Card, SkeletonBlock } from './primitives';

export function EntryBrand() {
  return (
    <div className="entry-brand">
      <span className="brand-mark" aria-hidden="true">
        SF
      </span>
      <span className="shell-brand-text">
        <span className="brand-name">Shanda Fuel</span>
        <span className="brand-byline">by ShandaHR</span>
      </span>
    </div>
  );
}

export function EntryLoadingState() {
  return (
    <main className="entry-layout" aria-labelledby="entry-loading-title">
      <div className="entry-panel">
        <EntryBrand />
        <Card className="entry-card entry-loading-card">
          <span id="entry-loading-title" className="visually-hidden">
            Preparing your workspace
          </span>
          <div className="entry-loading-stack" aria-hidden="true">
            <SkeletonBlock width="38%" height="0.75rem" />
            <SkeletonBlock width="72%" height="1.5rem" />
            <SkeletonBlock width="92%" height="0.85rem" />
            <SkeletonBlock width="100%" height="3.5rem" />
          </div>
          <p className="entry-loading-message" role="status" aria-live="polite">
            Preparing your workspace…
          </p>
        </Card>
      </div>
    </main>
  );
}

export function NoAuthorisedContextState() {
  return (
    <main className="entry-layout" aria-labelledby="entry-access-title">
      <div className="entry-panel">
        <EntryBrand />
        <Card
          as="section"
          className="entry-card entry-state-card"
          aria-labelledby="entry-access-title"
        >
          <div className="entry-state-copy">
            <h1 id="entry-access-title">Your account isn’t ready yet</h1>
            <p>
              You’re signed in, but no workplace has been assigned to this account. Ask your
              administrator to assign access.
            </p>
          </div>
          <div className="entry-actions entry-actions-secondary">
            <SignOutButton />
          </div>
        </Card>
      </div>
    </main>
  );
}

export function EntryUnavailableState() {
  return (
    <main className="entry-layout" aria-labelledby="entry-unavailable-title">
      <div className="entry-panel">
        <EntryBrand />
        <Card
          as="section"
          className="entry-card entry-state-card"
          aria-labelledby="entry-unavailable-title"
        >
          <div className="entry-state-copy">
            <h1 id="entry-unavailable-title">We couldn’t load your workspace</h1>
            <p>
              We couldn’t check your workspace right now. Try again, or sign out and use another
              account.
            </p>
          </div>
          <div className="entry-actions">
            <Link className="button button-primary" href="/">
              Try again
            </Link>
            <SignOutButton />
          </div>
        </Card>
      </div>
    </main>
  );
}

export function RootContextChooser({ resolution }: { resolution: ContextResolution }) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const options = useMemo(
    () => listContextOptions(resolution.available, resolution.route.policy),
    [resolution],
  );
  const [selectedKey, setSelectedKey] = useState(() => optionKey(options[0]?.selection));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = options.find((option) => optionKey(option.selection) === selectedKey);

  async function continueToToday() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/context', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pathname, selection: selected.selection }),
      });
      const body = (await response.json().catch(() => null)) as {
        data?: { current?: ContextSelection };
        message?: string;
      } | null;
      if (!response.ok || !body?.data?.current) {
        throw new Error(body?.message ?? 'That workplace is no longer available.');
      }
      router.replace(buildContextHref(pathname, '', body.data.current));
      router.refresh();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'The workplace could not be selected.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="entry-layout" aria-labelledby="entry-context-title">
      <div className="entry-panel entry-panel-wide">
        <EntryBrand />
        <Card as="section" className="entry-card" aria-labelledby="entry-context-title">
          <div className="entry-state-copy">
            <h1 id="entry-context-title">Where are you working?</h1>
            <p>Choose the organisation, legal entity, and station for today’s work.</p>
          </div>

          <div className="entry-choice-list" role="radiogroup" aria-label="Workplaces">
            {options.map((option) => {
              const key = optionKey(option.selection);
              const selectedOption = key === selectedKey;
              return (
                <button
                  className={`entry-choice${selectedOption ? ' entry-choice-selected' : ''}`}
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={selectedOption}
                  onClick={() => setSelectedKey(key)}
                  disabled={submitting}
                >
                  <span className="entry-choice-marker" aria-hidden="true" />
                  <span className="entry-choice-copy">
                    <strong>
                      {option.stationName ?? option.legalEntityName ?? option.organisationName}
                    </strong>
                    <span>
                      {[
                        option.stationCode,
                        option.stationName && option.legalEntityName,
                        !option.stationName && option.legalEntityName !== undefined
                          ? option.organisationName
                          : option.legalEntityName,
                        option.selection.allStations ? 'All stations' : undefined,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="entry-actions">
            <Button
              block
              type="button"
              loading={submitting}
              disabled={!selected}
              onClick={continueToToday}
            >
              Continue to Today
            </Button>
          </div>
        </Card>
      </div>
    </main>
  );
}

function optionKey(selection: ContextSelection | undefined): string {
  if (!selection) return '';
  return [
    selection.organisationId,
    selection.legalEntityId ?? '',
    selection.stationId ?? '',
    selection.allStations ? 'all' : 'single',
  ].join(':');
}
