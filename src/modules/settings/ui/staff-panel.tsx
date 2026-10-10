'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/design-system/primitives';

import type { RoleCode } from '@/modules/authorization';
import type { SettingsView } from '../contracts';
import styles from './settings-workspace.module.css';

type StaffOverview = NonNullable<SettingsView['staff']>;
type Role = Exclude<RoleCode, 'OWNER'> | 'OWNER';

const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  ADMINISTRATOR: 'Administrator',
  FINANCE: 'Finance',
  SUPERVISOR: 'Supervisor',
  ATTENDANT: 'Attendant',
};

function defaultScope(role: Role) {
  return role === 'OWNER' || role === 'ADMINISTRATOR'
    ? 'TENANT'
    : role === 'FINANCE'
      ? 'LEGAL_ENTITY'
      : 'STATION';
}

export function StaffPanel({ tenantId, overview }: { tenantId: string; overview: StaffOverview }) {
  const [role, setRole] = useState<Role>('ATTENDANT');
  const [scopeType, setScopeType] = useState<'TENANT' | 'LEGAL_ENTITY' | 'STATION'>(
    defaultScope('ATTENDANT'),
  );
  const [legalEntityId, setLegalEntityId] = useState('');
  const [stationIds, setStationIds] = useState<string[]>([]);
  const [deliveryMethod, setDeliveryMethod] = useState<'EMAIL' | 'MANUAL'>('EMAIL');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [manualActivation, setManualActivation] = useState<{
    staffNumber: string;
    activationCode: string;
    expiresAt: string;
  }>();

  const legalEntity = useMemo(
    () => overview.scopeOptions.find((option) => option.id === legalEntityId),
    [legalEntityId, overview.scopeOptions],
  );

  function changeRole(nextRole: Role) {
    setRole(nextRole);
    const nextScope = defaultScope(nextRole) as 'TENANT' | 'LEGAL_ENTITY' | 'STATION';
    setScopeType(nextScope);
    if (nextScope === 'TENANT') {
      setLegalEntityId('');
      setStationIds([]);
    }
  }

  async function command(body: Record<string, unknown>, reload = true) {
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await fetch('/api/staff/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, ...body }),
      });
      if (!response.ok) {
        setMessage('That action could not be completed. Check your access or try again.');
        return false;
      }
      const result = (await response.json().catch(() => null)) as unknown;
      setMessage('Saved.');
      if (reload) window.location.reload();
      return result;
    } catch {
      setMessage('That action could not be completed. Check your connection and try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await command(
      {
        commandType: 'CreateStaffInvitation',
        invitedName: String(form.get('name') ?? ''),
        ...(deliveryMethod === 'EMAIL'
          ? { invitedEmail: String(form.get('email') ?? ''), deliveryMethod }
          : { deliveryMethod }),
        assignedRole: role,
        scopeType,
        ...(legalEntityId ? { legalEntityId } : {}),
        stationIds,
      },
      false,
    );
    if (
      result &&
      typeof result === 'object' &&
      'deliveryMethod' in result &&
      result.deliveryMethod === 'MANUAL'
    ) {
      const manual = result as unknown as {
        staffNumber: string;
        activationCode: string;
        expiresAt: string;
      };
      setManualActivation(manual);
    } else if (result) {
      window.location.reload();
    }
  }

  async function generateManual(invitationId: string) {
    const result = await command(
      { commandType: 'GenerateManualStaffActivation', invitationId },
      false,
    );
    if (result && typeof result === 'object' && 'activationCode' in result) {
      setManualActivation(
        result as unknown as { staffNumber: string; activationCode: string; expiresAt: string },
      );
    } else if (result) {
      window.location.reload();
    }
  }

  function toggleStation(stationId: string) {
    setStationIds((current) =>
      current.includes(stationId)
        ? current.filter((id) => id !== stationId)
        : [...current, stationId],
    );
  }

  return (
    <div className={styles.staffPanel}>
      <div className={styles.card}>
        <div className={styles.staffHeader}>
          <div>
            <h3 className={styles.cardTitle}>Invite staff</h3>
            <p className={styles.note}>
              Invitations expire after 72 hours and can be resent or revoked.
            </p>
          </div>
        </div>
        <form className={styles.staffForm} onSubmit={submitInvite}>
          <label>
            <span>Name</span>
            <input name="name" required maxLength={160} />
          </label>
          <label>
            <span>Delivery</span>
            <select
              value={deliveryMethod}
              onChange={(event) => setDeliveryMethod(event.target.value as 'EMAIL' | 'MANUAL')}
            >
              <option value="EMAIL">Email invitation</option>
              <option value="MANUAL">Manual activation</option>
            </select>
          </label>
          {deliveryMethod === 'EMAIL' ? (
            <label>
              <span>Email</span>
              <input name="email" type="email" required maxLength={320} />
            </label>
          ) : (
            <p className={styles.note}>
              The Staff Number and activation code will be shown once after creation.
            </p>
          )}
          <label>
            <span>Role</span>
            <select value={role} onChange={(event) => changeRole(event.target.value as Role)}>
              {(Object.keys(ROLE_LABELS) as Role[])
                .filter((item) => item !== 'OWNER' || overview.canInviteOwner)
                .map((item) => (
                  <option key={item} value={item}>
                    {ROLE_LABELS[item]}
                  </option>
                ))}
            </select>
          </label>
          {role !== 'OWNER' && role !== 'ADMINISTRATOR' ? (
            <label>
              <span>Scope</span>
              <select
                value={scopeType}
                onChange={(event) => {
                  const next = event.target.value as 'LEGAL_ENTITY' | 'STATION';
                  setScopeType(next);
                  setStationIds([]);
                }}
              >
                {role === 'FINANCE' ? <option value="LEGAL_ENTITY">Legal entity</option> : null}
                <option value="STATION">Selected stations</option>
              </select>
            </label>
          ) : null}
          {scopeType !== 'TENANT' ? (
            <label>
              <span>Legal entity</span>
              <select
                required
                value={legalEntityId}
                onChange={(event) => {
                  setLegalEntityId(event.target.value);
                  setStationIds([]);
                }}
              >
                <option value="">Choose a legal entity</option>
                {overview.scopeOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {scopeType === 'STATION' ? (
            <fieldset className={styles.staffStations}>
              <legend>Stations</legend>
              {legalEntity?.stations.length ? (
                legalEntity.stations.map((station) => (
                  <label key={station.id} className={styles.staffCheck}>
                    <input
                      type="checkbox"
                      checked={stationIds.includes(station.id)}
                      onChange={() => toggleStation(station.id)}
                    />
                    <span>
                      {station.name} <small>{station.code}</small>
                    </span>
                  </label>
                ))
              ) : (
                <p className={styles.note}>Choose a legal entity to see stations.</p>
              )}
            </fieldset>
          ) : null}
          <Button type="submit" variant="primary" loading={busy}>
            {deliveryMethod === 'EMAIL' ? 'Send invitation' : 'Generate manual activation'}
          </Button>
        </form>
        {message ? (
          <p className={styles.staffMessage} role="status">
            {message}
          </p>
        ) : null}
        {manualActivation ? (
          <section
            className={styles.card}
            aria-labelledby="manual-activation-title"
            aria-live="polite"
          >
            <h3 className={styles.cardTitle} id="manual-activation-title">
              Staff invitation created
            </h3>
            <p className={styles.note}>
              This activation code is shown once. Generate a new code if it is lost.
            </p>
            <dl>
              <div>
                <dt>Staff Number</dt>
                <dd>{manualActivation.staffNumber}</dd>
              </div>
              <div>
                <dt>Activation Code</dt>
                <dd>{manualActivation.activationCode}</dd>
              </div>
              <div>
                <dt>Expires</dt>
                <dd>{new Date(manualActivation.expiresAt).toLocaleString()}</dd>
              </div>
            </dl>
            <div className={styles.staffActions}>
              <Button
                type="button"
                variant="quiet"
                onClick={() =>
                  navigator.clipboard?.writeText(
                    `${manualActivation.staffNumber}\n${manualActivation.activationCode}`,
                  )
                }
              >
                Copy invitation
              </Button>
              <Button type="button" variant="quiet" onClick={() => window.print()}>
                Print
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => setManualActivation(undefined)}
              >
                Done
              </Button>
            </div>
          </section>
        ) : null}
      </div>

      <StaffList
        title="Pending invitations"
        items={overview.pendingInvitations.map((invitation) => ({
          id: invitation.id,
          title: `${invitation.name} · ${invitation.email ?? invitation.staffNumber ?? 'Manual activation'}`,
          detail: `${ROLE_LABELS[invitation.role]} · ${invitation.deliveryMethod === 'MANUAL' ? 'Manual activation' : invitation.status === 'EXPIRED' ? 'Expired' : 'Pending'}`,
          actions:
            invitation.status === 'PENDING' ? (
              <>
                {invitation.deliveryMethod === 'EMAIL' ? (
                  <Button
                    type="button"
                    variant="quiet"
                    size="sm"
                    onClick={() => generateManual(invitation.id)}
                  >
                    Generate manual activation
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="quiet"
                  size="sm"
                  onClick={() =>
                    command({ commandType: 'ResendStaffInvitation', invitationId: invitation.id })
                  }
                >
                  Resend
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() =>
                    command({ commandType: 'RevokeStaffInvitation', invitationId: invitation.id })
                  }
                >
                  Revoke
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="quiet"
                size="sm"
                onClick={() =>
                  command({ commandType: 'ResendStaffInvitation', invitationId: invitation.id })
                }
              >
                Resend
              </Button>
            ),
        }))}
      />

      <StaffList
        title="Active staff"
        items={overview.activeStaff.map((member) => ({
          id: member.membershipId,
          title: `${member.name} · ${member.email ?? member.staffNumber ?? 'Staff Number'}`,
          detail: member.roles.map((item) => ROLE_LABELS[item]).join(', ') || 'No role',
          actions:
            member.membershipId === undefined ? null : (
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() =>
                  command({
                    commandType: 'DeactivateStaffMember',
                    membershipId: member.membershipId,
                  })
                }
              >
                Deactivate
              </Button>
            ),
        }))}
      />

      <StaffList
        title="Deactivated staff"
        items={overview.deactivatedStaff.map((member) => ({
          id: member.membershipId,
          title: `${member.name} · ${member.email ?? member.staffNumber ?? 'Staff Number'}`,
          detail: 'Deactivated; history retained',
          actions: null,
        }))}
      />
    </div>
  );
}

function StaffList({
  title,
  items,
}: {
  title: string;
  items: readonly { id: string; title: string; detail: string; actions: React.ReactNode }[];
}) {
  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>{title}</h3>
      {items.length ? (
        <div className={styles.staffList}>
          {items.map((item) => (
            <div className={styles.staffRow} key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </div>
              <div className={styles.staffActions}>{item.actions}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.note}>None.</p>
      )}
    </div>
  );
}
