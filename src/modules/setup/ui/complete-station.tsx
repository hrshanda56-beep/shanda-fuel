'use client';

import { useState } from 'react';

import { Modal } from '@/design-system/modal';
import { AccessDeniedState, Button, ErrorState, LoadingState } from '@/design-system/primitives';
import { WizardNotice, WizardStep } from '@/design-system/wizard';
import { WizardAnother, WizardConfirm } from '@/design-system/wizard-kit';

import type { SettingsView } from '../../settings/contracts';
import { StaffInviteJob } from '../../settings/ui/staff-invite-job';
import type { SetupOverview, StationReadiness } from '../contracts';
import { nextTask, sayTasks, stationTasks, type StationNeeds } from '../complete-station';
import { PaymentJob } from './payments-panel';
import {
  StationStaging,
  StationWizardPage,
  useStationConfig,
  useStationWaiting,
} from './guided-setup-panel';

/**
 * Finishes one station (#251): asks only about what it still needs, one wizard at a time, then
 * "This station is now complete. Do you want to complete the next station?". Everything the person
 * answers waits in the usual list and is saved once, with one identity check.
 */
export function CompleteStation({
  tenantId,
  overview,
  staff,
  station,
  hasNext,
  canActivate,
  onChanged,
  onNext,
  onOpenStaff,
  onClose,
}: {
  tenantId: string;
  /** The setup overview the station came from (payment providers, stations). */
  overview: Extract<SetupOverview, { status: 'ready' }>;
  /** Who can be invited; absent when the person cannot manage staff. */
  staff?: NonNullable<SettingsView['staff']>;
  /** The station as the readiness check last read it. */
  station: StationReadiness;
  /** True when another station still has things to do. */
  hasNext: boolean;
  /** Whether the station can be made live right now (set after the readiness check is re-read). */
  canActivate: boolean;
  /** Re-reads the readiness check after changes were saved. */
  onChanged: () => void;
  /** "Yes, complete the next station": back to choosing one. */
  onNext: () => void;
  /** Takes the person to Staff, to assign someone to the station. */
  onOpenStaff?: () => void;
  onClose: () => void;
}) {
  const { state, refresh, reload } = useStationConfig(tenantId, station.stationId);
  if (state.kind === 'loading') {
    return (
      <Modal open onClose={onClose} title={station.stationName} presentation="page" size="md">
        <LoadingState label={`Loading ${station.stationName}`} />
      </Modal>
    );
  }
  if (state.kind === 'unavailable') {
    return (
      <Modal open onClose={onClose} title={station.stationName} presentation="page" size="md">
        <AccessDeniedState message="You do not have access to set up this station." />
      </Modal>
    );
  }
  if (state.kind === 'error') {
    return (
      <Modal open onClose={onClose} title={station.stationName} presentation="page" size="md">
        <ErrorState
          title="This station could not be loaded"
          message="Nothing has been changed. Try again in a moment."
          action={<Button onClick={reload}>Try again</Button>}
        />
      </Modal>
    );
  }
  return (
    <StationStaging
      tenantId={tenantId}
      stationId={station.stationId}
      serverData={state.data}
      refresh={() => {
        refresh();
        onChanged();
      }}
    >
      <Loop
        station={station}
        overview={overview}
        staff={staff}
        hasNext={hasNext}
        canActivate={canActivate}
        tenantId={tenantId}
        onChanged={onChanged}
        onNext={onNext}
        onOpenStaff={onOpenStaff}
        onClose={onClose}
      />
    </StationStaging>
  );
}

function Loop({
  station,
  overview,
  staff,
  hasNext,
  canActivate,
  tenantId,
  onChanged,
  onNext,
  onOpenStaff,
  onClose,
}: {
  station: StationReadiness;
  overview: Extract<SetupOverview, { status: 'ready' }>;
  staff?: NonNullable<SettingsView['staff']>;
  hasNext: boolean;
  canActivate: boolean;
  tenantId: string;
  onChanged: () => void;
  onNext: () => void;
  onOpenStaff?: () => void;
  onClose: () => void;
}) {
  const { data, waiting, review } = useStationWaiting();
  const [started, setStarted] = useState(false);
  /** Jobs already shown once, so a job the person leaves undone is not asked forever. */
  const [offered, setOffered] = useState<ReadonlySet<string>>(new Set());
  const [activating, setActivating] = useState(false);
  const [activationError, setActivationError] = useState<string>();
  const [activated, setActivated] = useState(false);
  /** People invited from here. An invitation is not an assigned person until it is accepted. */
  const [invited, setInvited] = useState<readonly string[]>([]);

  // What the readiness check says is missing beyond the station's own setup. Someone invited from
  // here counts as asked, though the station cannot go live until they have joined.
  const needs: StationNeeds = {
    staff:
      station.missing.some((item) => item.code === 'STAFF') &&
      invited.length === 0 &&
      !station.wants?.invitationPending,
    providerAccount: overview.canManagePayments && Boolean(station.wants?.providerAccount),
    bankAccount: overview.canManagePayments && Boolean(station.wants?.bankAccount),
    openingStock: Boolean(station.wants?.openingStock),
  };
  const tasks = stationTasks(data, needs);
  // Opening stock needs the station's own changes saved first, so it waits until nothing waits.
  const task = nextTask(tasks, offered, waiting === 0);
  const alone = { position: 1, total: 0, captureHeading: () => undefined, back: onClose };
  const settingUp = station.stationStatus === 'ONBOARDING';
  const offer = (key: string) => setOffered((current) => new Set(current).add(key));

  async function activate() {
    setActivating(true);
    setActivationError(undefined);
    try {
      const response = await fetch('/api/forecourt/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          commandType: 'ActivateStation',
          tenantId,
          stationId: station.stationId,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setActivationError(
          body?.message ?? 'The station could not be made live. Nothing was changed.',
        );
        return;
      }
      setActivated(true);
      onChanged();
    } catch {
      setActivationError(
        'The station could not be made live. Check your connection and try again.',
      );
    } finally {
      setActivating(false);
    }
  }

  const page = (title: string, body: React.ReactNode) => (
    <Modal open onClose={onClose} title={title} presentation="page" size="md">
      {body}
    </Modal>
  );
  /** The last screen: asks about the next station, or just closes when there is none. */
  const ending = (title: string, nextTitle: string, hint?: string) =>
    page(
      station.stationName,
      hasNext ? (
        <WizardAnother
          wizard={alone}
          title={nextTitle}
          hint={hint}
          yesLabel="Yes, the next station"
          noLabel="No, I am done"
          onYes={onNext}
          onNo={onClose}
        />
      ) : (
        <WizardStep wizard={alone} title={title} hint={hint}>
          <Button type="button" onClick={onClose}>
            Close
          </Button>
        </WizardStep>
      ),
    );

  // Everything is set up, and the station goes live once the invited person has joined (someone
  // invited on an earlier visit counts too, though their name is no longer known here).
  const waitingForPerson =
    settingUp && !canActivate && (invited.length > 0 || Boolean(station.wants?.invitationPending));
  const who =
    invited.length === 1
      ? invited[0]
      : invited.length > 1
        ? `${invited.length} people`
        : 'the person you invited';
  const waitingEnding = ending(
    `${station.stationName} is set up. It can go live once ${who} has joined.`,
    `${station.stationName} is set up. It can go live once ${who} has joined. Do you want to complete the next station?`,
    'Come back to Readiness after they have accepted their invitation, and the station can be made live.',
  );

  // 1. What is left, and a way in.
  if (!started) {
    if (tasks.length === 0 && waitingForPerson) {
      return waitingEnding;
    }
    if (tasks.length === 0) {
      return ending(
        `${station.stationName} has everything it needs`,
        `${station.stationName} has everything it needs. Do you want to complete the next station?`,
      );
    }
    return page(
      station.stationName,
      <WizardConfirm
        title={`Let's finish ${station.stationName}`}
        consequence={`It still needs ${sayTasks(tasks)}. We will ask about each one. Nothing is saved until you review it.`}
        confirmLabel="Start"
        cancelLabel="Not now"
        onConfirm={() => setStarted(true)}
        onCancel={onClose}
      />,
    );
  }

  // 2. One job at a time, each in its own wizard.
  if (task) {
    const done = () => offer(task.key);
    const part = task.part;
    if (part.kind === 'provider' || part.kind === 'bank') {
      return (
        <PaymentJob
          key={task.key}
          overview={overview}
          stationId={station.stationId}
          job={part.kind}
          reload={onChanged}
          onClose={done}
        />
      );
    }
    if (part.kind === 'invite') {
      if (staff) {
        return (
          <StaffInviteJob
            key={task.key}
            tenantId={tenantId}
            overview={staff}
            station={{
              id: station.stationId,
              name: station.stationName,
              legalEntityId: station.legalEntityId,
            }}
            onDone={(names) => {
              setInvited((current) => [...current, ...names]);
              done();
            }}
          />
        );
      }
      // The person cannot manage staff here: say who to ask, or go to Staff.
      return page(
        'Staff',
        <WizardStep wizard={alone} title="Who works at this station?">
          <WizardNotice>
            Nobody is assigned to {station.stationName} yet. Someone who can manage staff needs to
            give a person a role at this station, then come back to finish.
            {waiting > 0 ? ' Save your waiting changes before you leave.' : ''}
          </WizardNotice>
          <div>
            {onOpenStaff && waiting === 0 ? (
              <Button type="button" onClick={onOpenStaff}>
                Go to Staff
              </Button>
            ) : null}{' '}
            <Button type="button" variant="secondary" onClick={done}>
              Skip for now
            </Button>
          </div>
        </WizardStep>,
      );
    }
    return (
      <StationWizardPage
        key={task.key}
        part={part.kind === 'opening' ? { kind: 'openingBalances' } : part}
        stationName={station.stationName}
        onOpenStaff={onOpenStaff}
        onClose={done}
      />
    );
  }

  // 3. Everything asked. Changes must be saved before the station counts as complete.
  if (waiting > 0) {
    return page(
      station.stationName,
      <WizardConfirm
        title={`Save the changes for ${station.stationName}?`}
        consequence={`You have ${waiting} ${waiting === 1 ? 'change' : 'changes'} waiting. Review them and save, then the station can be finished. If you leave now they are not saved.`}
        confirmLabel="Review and save"
        cancelLabel="Leave without saving"
        onConfirm={review}
        onCancel={onClose}
      />,
    );
  }

  // 4. Saved. Either complete, or something was left undone.
  const left = stationTasks(data, needs);
  if (left.length > 0) {
    return page(
      station.stationName,
      <WizardAnother
        wizard={alone}
        title={`${station.stationName} still needs ${sayTasks(left)}`}
        hint="Everything you answered is saved. You can go through what is left again, or leave it for now."
        yesLabel="Go through it again"
        noLabel={hasNext ? 'Leave it, go to the next station' : 'Leave it for now'}
        onYes={() => setOffered(new Set())}
        onNo={hasNext ? onNext : onClose}
      />,
    );
  }
  if (waitingForPerson) return waitingEnding;
  if (settingUp && canActivate && !activated) {
    return page(
      station.stationName,
      <WizardConfirm
        title="This station is now complete. Make it live?"
        consequence="Once it is live, shifts and sales can start. You can still change its setup afterwards."
        confirmLabel="Make it live"
        cancelLabel="Not yet"
        busy={activating}
        error={activationError}
        onConfirm={() => void activate()}
        onCancel={hasNext ? onNext : onClose}
      />,
    );
  }
  return ending(
    'This station is now complete. Every station is set up.',
    'This station is now complete. Do you want to complete the next station?',
  );
}
