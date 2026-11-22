'use client';

import { useState } from 'react';

import { Modal } from '@/design-system/modal';
import { Button } from '@/design-system/primitives';
import { WizardNotice, WizardStep } from '@/design-system/wizard';
import { WizardAnother } from '@/design-system/wizard-kit';

import type { SettingsView } from '../contracts';
import { staffInvitationCommand } from '../staff-invite-checks';
import { STAFF_ROLE_LABELS } from '../staff-role-labels';
import { formatStaffInvitationMessage } from './staff-invitation-message';
import { StaffInviteWizard, type StaffInviteValue } from './staff-invite-wizard';

type StaffOverview = NonNullable<SettingsView['staff']>;

type Manual = { staffNumber: string; activationCode: string; expiresAt: string };

type Phase =
  | { kind: 'ask' }
  /** The invitation was created. Manual ones show the code once; email ones say it was sent. */
  | { kind: 'sent'; name: string; manual?: Manual; emailFailed?: boolean; address?: string };

/**
 * "Who works at this station?" inside the complete-this-station loop (#251): the same invite
 * wizard the Staff page uses, with the station already fixed, so nobody has to leave the loop
 * to give someone a role. Each invitation is saved straight away (it is not part of the waiting
 * station changes) and the loop is told who was invited.
 */
export function StaffInviteJob({
  tenantId,
  overview,
  station,
  onDone,
}: {
  tenantId: string;
  overview: StaffOverview;
  station: { id: string; name: string; legalEntityId: string };
  /**
   * The person is done (or chose to leave), with the names of everyone invited meanwhile. It is
   * called only at the end, so the one-time activation code stays on screen until then.
   */
  onDone: (invited: readonly string[]) => void;
}) {
  const [names, setNames] = useState<readonly string[]>([]);
  const onClose = () => onDone(names);
  const [phase, setPhase] = useState<Phase>({ kind: 'ask' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState<string>();
  // A new run starts the questions again from the top for the next person.
  const [run, setRun] = useState(0);
  const alone = { position: 1, total: 0, captureHeading: () => undefined, back: onClose };

  async function submit(value: StaffInviteValue) {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch('/api/staff/commands', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, ...staffInvitationCommand(value) }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { message?: string } | null;
        setError(
          failure?.message ??
            'The invitation could not be created. Check your access or try again.',
        );
        return;
      }
      const result = (await response.json().catch(() => null)) as {
        deliveryMethod?: string;
        delivery?: string;
        staffNumber?: string;
        activationCode?: string;
        expiresAt?: string;
      } | null;
      setNames((current) => [...current, value.name]);
      if (result?.deliveryMethod === 'MANUAL' && result.activationCode) {
        setPhase({
          kind: 'sent',
          name: value.name,
          manual: {
            staffNumber: result.staffNumber ?? '',
            activationCode: result.activationCode,
            expiresAt: result.expiresAt ?? '',
          },
        });
      } else {
        setPhase({
          kind: 'sent',
          name: value.name,
          address: value.email,
          emailFailed: result?.delivery === 'failed',
        });
      }
    } catch {
      setError('The invitation could not be created. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(manual: Manual) {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(
        formatStaffInvitationMessage(manual, window.location.origin),
      );
      setCopied('Invitation copied. Share it privately with them.');
    } catch {
      setCopied('Could not copy it. Write down the staff number, code and expiry shown here.');
    }
  }

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title={`Who works at ${station.name}?`}
      presentation="page"
      size="md"
      backLabel="Back to the station"
    >
      {phase.kind === 'ask' ? (
        <>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <StaffInviteWizard
            key={run}
            overview={overview}
            roleLabels={STAFF_ROLE_LABELS}
            busy={busy}
            forStation={station}
            onCancel={onClose}
            onSubmit={(value) => void submit(value)}
          />
        </>
      ) : phase.manual ? (
        <WizardStep
          wizard={alone}
          title={`${phase.name} is invited`}
          hint="This activation code is shown once. Give it to them privately."
        >
          <dl>
            <div>
              <dt>Staff number</dt>
              <dd>{phase.manual.staffNumber}</dd>
            </div>
            <div>
              <dt>Activation code</dt>
              <dd>{phase.manual.activationCode}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{new Date(phase.manual.expiresAt).toLocaleString()}</dd>
            </div>
          </dl>
          {copied ? <WizardNotice>{copied}</WizardNotice> : null}
          <div>
            <Button type="button" variant="secondary" onClick={() => void copy(phase.manual!)}>
              Copy invitation
            </Button>{' '}
            <Button type="button" onClick={() => setPhase({ kind: 'sent', name: phase.name })}>
              I have shared it
            </Button>
          </div>
        </WizardStep>
      ) : (
        <WizardAnother
          wizard={alone}
          title={
            phase.emailFailed
              ? `${phase.name} was invited, but the email could not be sent`
              : phase.address
                ? `Invitation emailed to ${phase.address}. Do you want to invite someone else?`
                : `${phase.name} is invited. Do you want to invite someone else?`
          }
          hint={
            phase.emailFailed
              ? 'Check the address, or invite them again with a staff number instead. The station can go live once someone has joined.'
              : 'The station can go live once someone has accepted and joined it.'
          }
          yesLabel="Yes, invite someone else"
          noLabel="No, I am done"
          onYes={() => {
            setCopied(undefined);
            setRun((value) => value + 1);
            setPhase({ kind: 'ask' });
          }}
          onNo={onClose}
        />
      )}
    </Modal>
  );
}
