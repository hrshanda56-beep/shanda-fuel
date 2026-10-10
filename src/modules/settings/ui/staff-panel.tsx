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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

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

  async function command(body: Record<string, unknown>) {
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
      setMessage('Saved.');
      window.location.reload();
      return true;
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
    await command({
      commandType: 'CreateStaffInvitation',
      invitedName: String(form.get('name') ?? ''),
      invitedEmail: String(form.get('email') ?? ''),
      assignedRole: role,
      scopeType,
      ...(legalEntityId ? { legalEntityId } : {}),
      stationIds,
    });
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
            <span>Email</span>
            <input name="email" type="email" required maxLength={320} />
          </label>
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
            Send invitation
          </Button>
        </form>
        {message ? (
          <p className={styles.staffMessage} role="status">
            {message}
          </p>
        ) : null}
      </div>

      <StaffList
        title="Pending invitations"
        items={overview.pendingInvitations.map((invitation) => ({
          id: invitation.id,
          title: `${invitation.name} · ${invitation.email}`,
          detail: `${ROLE_LABELS[invitation.role]} · ${invitation.status === 'EXPIRED' ? 'Expired' : 'Pending'}`,
          actions:
            invitation.status === 'PENDING' ? (
              <>
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
          title: `${member.name} · ${member.email}`,
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
          title: `${member.name} · ${member.email}`,
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
