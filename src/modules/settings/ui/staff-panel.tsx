'use client';

import { useReverification } from '@clerk/nextjs';
import { useMemo, useRef, useState } from 'react';
import { Icon } from '@/design-system/icons';
import { Button, EmptyState, StatusBadge } from '@/design-system/primitives';
import type { StatusTone } from '@/design-system/primitives';
import { Modal } from '@/design-system/modal';

import type { RoleCode } from '@/modules/authorization';
import type { SettingsView } from '../contracts';
import styles from './settings-workspace.module.css';
import { formatStaffInvitationMessage } from './staff-invitation-message';
import {
  ApplicationStepUpError,
  NetworkStepUpError,
  classifyStepUpFailure,
  stepUpFailureMessage,
} from './staff-step-up-diagnostics';

type StaffOverview = NonNullable<SettingsView['staff']>;
type Role = Exclude<RoleCode, 'OWNER'> | 'OWNER';
type StaffMember = StaffOverview['activeStaff'][number];

type DeactivationOutcome =
  | { kind: 'success'; message: string }
  | { kind: 'provider'; message: string }
  | { kind: 'blocked'; message: string };

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

type StaffFilter = 'all' | 'active' | 'invited' | 'deactivated';

const FILTERS: ReadonlyArray<{ value: StaffFilter; label: string }> = [
  { value: 'all', label: 'All Staff' },
  { value: 'active', label: 'Active' },
  { value: 'invited', label: 'Invited' },
  { value: 'deactivated', label: 'Deactivated' },
];

type StaffRowModel = {
  id: string;
  group: Exclude<StaffFilter, 'all'>;
  name: string;
  email: string | null;
  staffNumber?: string;
  role: string;
  scope: string;
  statusLabel: string;
  tone: StatusTone;
  actions: React.ReactNode;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}

export function StaffPanel({ tenantId, overview }: { tenantId: string; overview: StaffOverview }) {
  const [filter, setFilter] = useState<StaffFilter>('all');
  const [query, setQuery] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [role, setRole] = useState<Role>('ATTENDANT');
  const [scopeType, setScopeType] = useState<'TENANT' | 'LEGAL_ENTITY' | 'STATION'>(
    defaultScope('ATTENDANT'),
  );
  const [legalEntityId, setLegalEntityId] = useState('');
  const [stationIds, setStationIds] = useState<string[]>([]);
  const [deliveryMethod, setDeliveryMethod] = useState<'EMAIL' | 'MANUAL'>('MANUAL');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [manualActivation, setManualActivation] = useState<{
    staffNumber: string;
    activationCode: string;
    expiresAt: string;
  }>();
  const [deactivationTarget, setDeactivationTarget] = useState<StaffMember>();
  const [deactivationBusy, setDeactivationBusy] = useState(false);
  const [deactivationOutcome, setDeactivationOutcome] = useState<DeactivationOutcome>();
  const deactivationInFlight = useRef(false);

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
          : { deliveryMethod, staffNumber: String(form.get('staffNumber') ?? '').trim() }),
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
      setInviteOpen(false);
    } else if (result) {
      window.location.reload();
    }
  }

  async function generateManual(invitationId: string) {
    setBusy(true);
    setMessage(undefined);
    try {
      await verifyStaffManagement();
    } catch {
      setMessage(
        'Security verification was not completed. No new code was generated. This action requires recent MFA verification.',
      );
      setBusy(false);
      return;
    }
    const result = await command(
      { commandType: 'GenerateManualStaffActivation', invitationId },
      false,
    );
    if (result && typeof result === 'object' && 'activationCode' in result) {
      setManualActivation(
        result as unknown as { staffNumber: string; activationCode: string; expiresAt: string },
      );
      setSelectedId(undefined);
    } else if (result) {
      window.location.reload();
    }
  }

  const verifyStaffManagement = useReverification(async () => {
    const response = await fetch('/api/auth/step-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId, action: 'PRIVILEGED_OPERATION' }),
    });
    const body = (await response.json()) as { clerk_error?: unknown; message?: string };
    if (!response.ok && !body.clerk_error) throw new Error('Security verification required');
    return body;
  });

  function toggleStation(stationId: string) {
    setStationIds((current) =>
      current.includes(stationId)
        ? current.filter((id) => id !== stationId)
        : [...current, stationId],
    );
  }

  function openDeactivation(member: StaffMember) {
    setDeactivationTarget(member);
    setDeactivationOutcome(undefined);
  }

  function closeDeactivation() {
    if (deactivationBusy) return;
    setDeactivationTarget(undefined);
    setDeactivationOutcome(undefined);
  }

  async function submitDeactivation() {
    const member = deactivationTarget;
    if (!member || deactivationInFlight.current) return;
    deactivationInFlight.current = true;
    setDeactivationBusy(true);
    try {
      const response = await fetch('/api/staff/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          commandType: 'DeactivateStaffMember',
          membershipId: member.membershipId,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        message?: string;
        sessionsRevoked?: boolean;
        revocationStatus?: string;
        activeSessionsFound?: number;
        sessionsRevokedCount?: number;
      } | null;

      if (response.ok && body?.sessionsRevoked === true) {
        setDeactivationOutcome({
          kind: 'success',
          message: 'Staff member deactivated and Clerk sessions revoked.',
        });
        return;
      }

      if (response.status === 503 && body?.revocationStatus) {
        const status = body.revocationStatus;
        const sessionCounts =
          typeof body.activeSessionsFound === 'number' &&
          typeof body.sessionsRevokedCount === 'number'
            ? ` (${body.sessionsRevokedCount} of ${body.activeSessionsFound} provider sessions revoked)`
            : '';
        const detail =
          status === 'MAPPING_MISSING'
            ? 'No Clerk identity mapping was found, so no provider session was revoked.'
            : status === 'PARTIAL'
              ? `Provider revocation was incomplete${sessionCounts}.`
              : 'The provider revocation failed; no complete revocation is being reported.';
        setDeactivationOutcome({
          kind: 'provider',
          message: `The membership was disabled, but ${detail} Retry only after reviewing the provider state.`,
        });
        return;
      }

      setDeactivationOutcome({
        kind: 'blocked',
        message:
          body?.message ?? 'The deactivation was rejected. No membership change was reported.',
      });
    } catch {
      setDeactivationOutcome({
        kind: 'blocked',
        message: 'The deactivation could not be submitted. No membership change was reported.',
      });
    } finally {
      deactivationInFlight.current = false;
      setDeactivationBusy(false);
    }
  }

  const stationNames = new Map(
    overview.scopeOptions.flatMap((option) => option.stations.map((item) => [item.id, item.name])),
  );
  const entityNames = new Map(overview.scopeOptions.map((option) => [option.id, option.name]));

  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const scopeText = (labels: readonly string[]) =>
    labels
      .map((label) =>
        label
          .replace(/^Station\s+(?=[0-9a-f]{8}-)/i, '')
          .replace(uuid, (id) => stationNames.get(id) ?? entityNames.get(id) ?? 'Station'),
      )
      .join(', ') || '—';

  function invitationScope(invitation: (typeof overview.pendingInvitations)[number]) {
    if (invitation.scopeType === 'TENANT') return 'All stations';
    if (invitation.scopeType === 'LEGAL_ENTITY')
      return entityNames.get(invitation.legalEntityId ?? '') ?? 'Legal entity';
    return invitation.stationIds.map((id) => stationNames.get(id) ?? 'Station').join(', ') || '—';
  }

  const rows: StaffRowModel[] = [
    ...overview.activeStaff.map((member): StaffRowModel => ({
      id: member.membershipId,
      group: 'active',
      name: member.name,
      email: member.email,
      ...(member.staffNumber ? { staffNumber: member.staffNumber } : {}),
      role: member.roles.map((item) => ROLE_LABELS[item]).join(', ') || 'No role',
      scope: scopeText(member.scopeLabels),
      statusLabel: 'Active',
      tone: 'positive',
      actions: (
        <Button
          type="button"
          variant="quiet"
          className={styles.staffDanger}
          size="sm"
          onClick={() => openDeactivation(member)}
          disabled={busy || deactivationBusy}
        >
          Deactivate
        </Button>
      ),
    })),
    ...overview.pendingInvitations.map((invitation): StaffRowModel => ({
      id: invitation.id,
      group: 'invited',
      name: invitation.name,
      email: invitation.email,
      ...(invitation.staffNumber ? { staffNumber: invitation.staffNumber } : {}),
      role: ROLE_LABELS[invitation.role],
      scope: invitationScope(invitation),
      statusLabel: invitation.status === 'EXPIRED' ? 'Expired' : 'Pending',
      tone: invitation.status === 'EXPIRED' ? 'warning' : 'pending',
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
                Switch to staff-number activation
              </Button>
            ) : null}
            <Button
              type="button"
              variant="quiet"
              size="sm"
              disabled={busy}
              onClick={() =>
                invitation.deliveryMethod === 'MANUAL'
                  ? generateManual(invitation.id)
                  : command({ commandType: 'ResendStaffInvitation', invitationId: invitation.id })
              }
            >
              {invitation.deliveryMethod === 'MANUAL'
                ? 'Generate new activation code'
                : 'Resend email invitation'}
            </Button>
            <Button
              type="button"
              variant="quiet"
              className={styles.staffDanger}
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
            disabled={busy}
            onClick={() =>
              invitation.deliveryMethod === 'MANUAL'
                ? generateManual(invitation.id)
                : command({ commandType: 'ResendStaffInvitation', invitationId: invitation.id })
            }
          >
            {invitation.deliveryMethod === 'MANUAL'
              ? 'Generate new activation code'
              : 'Resend email invitation'}
          </Button>
        ),
    })),
    ...overview.deactivatedStaff.map((member): StaffRowModel => ({
      id: member.membershipId,
      group: 'deactivated',
      name: member.name,
      email: member.email,
      ...(member.staffNumber ? { staffNumber: member.staffNumber } : {}),
      role: member.roles.map((item) => ROLE_LABELS[item]).join(', ') || '—',
      scope: scopeText(member.scopeLabels),
      statusLabel: 'Deactivated',
      tone: 'neutral',
      actions: null,
    })),
  ];

  const selectedRow = rows.find((row) => row.id === selectedId);

  const needle = query.trim().toLowerCase();
  const visibleRows = rows.filter(
    (row) =>
      (filter === 'all' || row.group === filter) &&
      (needle === '' ||
        [row.name, row.email ?? '', row.staffNumber ?? '', row.role, row.scope].some((value) =>
          value.toLowerCase().includes(needle),
        )),
  );
  const countFor = (value: StaffFilter) =>
    value === 'all' ? rows.length : rows.filter((row) => row.group === value).length;

  return (
    <div className={styles.staffPanel}>
      <div className={styles.staffToolbar}>
        <label className={styles.staffSearch}>
          <Icon name="search" />
          <input
            type="search"
            placeholder="Search staff…"
            aria-label="Search staff"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className={styles.staffFilters} role="group" aria-label="Filter staff">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={styles.staffFilter}
              aria-pressed={filter === item.value}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
              <span>{countFor(item.value)}</span>
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant="primary"
          className={styles.staffInviteButton}
          aria-haspopup="dialog"
          onClick={() => setInviteOpen(true)}
        >
          Invite Staff
        </Button>
      </div>

      {message ? (
        <p className={styles.staffMessage} role="status">
          {message}
        </p>
      ) : null}

      {visibleRows.length === 0 ? (
        rows.length === 0 ? (
          <EmptyState
            layout="block"
            icon="users"
            title="No staff yet"
            message="Invite your first team member to get started."
            action={
              <Button type="button" variant="primary" onClick={() => setInviteOpen(true)}>
                Invite Staff
              </Button>
            }
          />
        ) : (
          <EmptyState
            layout="block"
            icon="search"
            title="No staff match"
            message="Try a different name, email or role."
          />
        )
      ) : (
        <div className={styles.staffTable}>
          <div className={styles.staffHead} aria-hidden="true">
            <span>Name</span>
            <span>Email</span>
            <span>Role</span>
            <span>Scope</span>
            <span>Status</span>
          </div>
          <ul className={styles.staffRows}>
            {visibleRows.map((row) => (
              <li
                key={row.id}
                className={styles.staffTableRow}
                onClick={() => setSelectedId(row.id)}
              >
                <div className={styles.staffName}>
                  <span className={styles.staffAvatar} aria-hidden="true">
                    {initials(row.name)}
                  </span>
                  <div>
                    <button
                      type="button"
                      className={styles.staffOpen}
                      aria-haspopup="dialog"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedId(row.id);
                      }}
                    >
                      {row.name}
                    </button>
                    {row.staffNumber ? <small>{row.staffNumber}</small> : null}
                  </div>
                </div>
                <div className={styles.staffCell} data-label="Email">
                  <span>{row.email ?? '—'}</span>
                </div>
                <div className={styles.staffCell} data-label="Role">
                  <span>{row.role}</span>
                </div>
                <div className={styles.staffCell} data-label="Scope">
                  <span>{row.scope}</span>
                </div>
                <div className={styles.staffCell} data-label="Status">
                  <StatusBadge
                    tone={row.tone}
                    {...(row.tone === 'pending'
                      ? { className: `status status-pending ${styles.staffPending}` }
                      : {})}
                  >
                    {row.statusLabel}
                  </StatusBadge>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal
        open={selectedRow !== undefined}
        onClose={() => setSelectedId(undefined)}
        title={selectedRow?.name ?? 'Staff member'}
        description={selectedRow?.staffNumber}
        presentation="side"
      >
        {selectedRow ? (
          <div className={styles.staffDetail}>
            {message ? (
              <p role="status" className={styles.staffMessage}>
                {message}
              </p>
            ) : null}
            <StatusBadge
              tone={selectedRow.tone}
              {...(selectedRow.tone === 'pending'
                ? { className: `status status-pending ${styles.staffPending}` }
                : {})}
            >
              {selectedRow.statusLabel}
            </StatusBadge>
            <dl className={styles.staffFacts}>
              <div>
                <dt>Email</dt>
                <dd>{selectedRow.email ?? '—'}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{selectedRow.role}</dd>
              </div>
              <div>
                <dt>Scope</dt>
                <dd>{selectedRow.scope}</dd>
              </div>
            </dl>
            {selectedRow.actions ? (
              <div className={styles.staffActions}>{selectedRow.actions}</div>
            ) : (
              <p className={styles.note}>No actions available for this staff member.</p>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite staff"
        description="Invitations expire after 72 hours and can be resent or revoked."
        presentation="side"
      >
        <form className={styles.staffForm} onSubmit={submitInvite}>
          <label>
            <span>Name</span>
            <input name="name" required maxLength={160} />
          </label>
          <label>
            <span>Invite using</span>
            <select
              value={deliveryMethod}
              onChange={(event) => setDeliveryMethod(event.target.value as 'EMAIL' | 'MANUAL')}
            >
              <option value="MANUAL">Staff number</option>
              <option value="EMAIL">Email</option>
            </select>
          </label>
          {deliveryMethod === 'EMAIL' ? (
            <label>
              <span>Email</span>
              <input name="email" type="email" required maxLength={320} />
            </label>
          ) : (
            <label>
              <span>Staff number (optional)</span>
              <input
                name="staffNumber"
                maxLength={32}
                minLength={4}
                autoCapitalize="characters"
                aria-describedby="staff-number-help"
              />
              <small id="staff-number-help">
                Leave blank to generate a staff number automatically. Use 4–32 letters, numbers,
                hyphens or underscores. This is their login username.
              </small>
            </label>
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
      </Modal>

      <Modal
        open={Boolean(manualActivation)}
        onClose={() => setManualActivation(undefined)}
        title="Staff invitation created"
        description="This activation code is shown once. Generate a new code if it is lost."
        footer={
          <>
            <Button
              type="button"
              variant="quiet"
              onClick={async () => {
                if (!manualActivation) return;
                try {
                  if (!navigator.clipboard) throw new Error('Clipboard unavailable');
                  await navigator.clipboard.writeText(
                    formatStaffInvitationMessage(manualActivation, window.location.origin),
                  );
                  setMessage('Invitation copied. Share it privately with the employee.');
                } catch {
                  setMessage(
                    'Could not copy the invitation. Copy the staff number, code and expiry shown here manually.',
                  );
                }
              }}
            >
              Copy invitation
            </Button>
            <Button type="button" variant="quiet" onClick={() => window.print()}>
              Print
            </Button>
            <Button type="button" variant="primary" onClick={() => setManualActivation(undefined)}>
              Done
            </Button>
          </>
        }
      >
        {manualActivation ? (
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
        ) : null}
      </Modal>

      <Modal
        open={Boolean(deactivationTarget)}
        onClose={closeDeactivation}
        title="Deactivate staff member?"
        description="This disables the selected membership and revokes its authentication sessions. The server will recheck your tenant authority before making any change."
        role="alertdialog"
        dismissible={!deactivationBusy}
        footer={
          deactivationOutcome ? (
            <>
              {deactivationOutcome.kind === 'provider' ? (
                <Button
                  variant="secondary"
                  onClick={() => setDeactivationOutcome(undefined)}
                  disabled={deactivationBusy}
                >
                  Review and retry
                </Button>
              ) : null}
              <Button
                variant="primary"
                onClick={() => {
                  const shouldReload = deactivationOutcome.kind === 'success';
                  closeDeactivation();
                  if (shouldReload) window.location.reload();
                }}
              >
                Done
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={closeDeactivation} disabled={deactivationBusy}>
              Cancel
            </Button>
          )
        }
      >
        {deactivationTarget ? (
          <>
            <p className="semantic-note">
              {deactivationTarget.name} will lose workplace access immediately. This action cannot
              be undone from this screen.
            </p>
            {deactivationOutcome ? (
              <p
                className={`state ${deactivationOutcome.kind === 'success' ? 'state-success' : 'state-error'}`}
                role={deactivationOutcome.kind === 'success' ? 'status' : 'alert'}
              >
                {deactivationOutcome.message}
              </p>
            ) : (
              <ClerkStaffDeactivationStepUp
                tenantId={tenantId}
                busy={deactivationBusy}
                onVerified={submitDeactivation}
              />
            )}
          </>
        ) : null}
      </Modal>
    </div>
  );
}

function ClerkStaffDeactivationStepUp({
  tenantId,
  busy,
  onVerified,
}: {
  tenantId: string;
  busy: boolean;
  onVerified: () => Promise<void>;
}) {
  const [stepUpBusy, setStepUpBusy] = useState(false);
  const [stepUpError, setStepUpError] = useState<string>();
  const clerkAwareStepUp = useReverification(async () => {
    let response: Response;
    try {
      response = await fetch('/api/auth/step-up', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, action: 'DEACTIVATE_STAFF_MEMBER' }),
      });
    } catch {
      throw new NetworkStepUpError();
    }
    const body = (await response.json()) as { message?: string; clerk_error?: unknown };
    if (!response.ok) {
      if (body.clerk_error) return body;
      throw new ApplicationStepUpError();
    }
    return body;
  });

  async function verify() {
    setStepUpBusy(true);
    setStepUpError(undefined);
    try {
      await clerkAwareStepUp();
    } catch (error) {
      setStepUpError(stepUpFailureMessage(classifyStepUpFailure(error)));
      setStepUpBusy(false);
      return;
    }
    try {
      await onVerified();
    } catch {
      setStepUpError('The deactivation command could not be submitted. No change was reported.');
    } finally {
      setStepUpBusy(false);
    }
  }

  return (
    <div className="step-up-form" aria-describedby="staff-deactivation-step-up-help">
      <p className="semantic-note" id="staff-deactivation-step-up-help">
        Clerk will ask you to reverify your password before the deactivation command is submitted.
      </p>
      <Button
        type="button"
        variant="danger"
        onClick={() => void verify()}
        disabled={busy || stepUpBusy}
        loading={stepUpBusy}
      >
        Reverify and deactivate
      </Button>
      {stepUpError ? (
        <p className="state state-error" role="alert">
          {stepUpError}
        </p>
      ) : null}
    </div>
  );
}
