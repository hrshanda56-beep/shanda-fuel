'use client';

import { useState } from 'react';
import { Select } from '@/design-system/forms';
import { InfoTip } from '@/design-system/info-tip';
import { Field } from '@/design-system/primitives';
import {
  WizardActions,
  WizardChoice,
  WizardChoices,
  WizardStep,
  WIZARD_REVIEW_HINT,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
} from '@/design-system/wizard';
import type { RoleCode } from '@/modules/authorization';
import { defaultScopeForRole, scopeChoicesForRole } from '@/modules/staff/role-scopes';
import type { SettingsView } from '../contracts';
import {
  checkInviteEmail,
  checkInviteName,
  checkInviteScope,
  checkInviteStaffNumber,
} from '../staff-invite-checks';
import styles from './settings-workspace.module.css';

type StaffOverview = NonNullable<SettingsView['staff']>;
type Scope = 'TENANT' | 'LEGAL_ENTITY' | 'STATION';
type InviteStep = 'name' | 'method' | 'contact' | 'role' | 'scope' | 'review';

export type StaffInviteValue = {
  name: string;
  deliveryMethod: 'EMAIL' | 'MANUAL';
  email: string;
  staffNumber: string;
  role: RoleCode;
  scopeType: Scope;
  legalEntityId: string;
  stationIds: string[];
};

/** Invite one person, one question at a time, ending in a check screen. */
export function StaffInviteWizard({
  overview,
  roleLabels,
  busy,
  forStation,
  onCancel,
  onSubmit,
}: {
  overview: StaffOverview;
  roleLabels: Record<RoleCode, string>;
  busy: boolean;
  /**
   * When the person is being invited to work at one particular station (the "complete this
   * station" loop), the station is fixed: only roles that work at a station are offered and the
   * "Where will they work?" question is not asked.
   */
  forStation?: { id: string; name: string; legalEntityId: string };
  onCancel: () => void;
  onSubmit: (value: StaffInviteValue) => void;
}) {
  const [name, setName] = useState('');
  const [method, setMethod] = useState<'EMAIL' | 'MANUAL'>('MANUAL');
  const [email, setEmail] = useState('');
  const [staffNumber, setStaffNumber] = useState('');
  const [role, setRole] = useState<RoleCode>('ATTENDANT');
  const [scopeType, setScopeType] = useState<Scope>(defaultScopeForRole('ATTENDANT'));
  const onlyCompany = overview.scopeOptions.length === 1 ? overview.scopeOptions[0]!.id : '';
  const [legalEntityId, setLegalEntityId] = useState(forStation?.legalEntityId ?? onlyCompany);
  const [stationIds, setStationIds] = useState<string[]>(forStation ? [forStation.id] : []);

  const needsScope = !forStation && defaultScopeForRole(role) !== 'TENANT';
  const sequence: readonly InviteStep[] = [
    'name',
    'method',
    'contact',
    'role',
    ...(needsScope ? (['scope'] as const) : []),
    'review',
  ];
  const wizard = useWizard<InviteStep>({ start: 'name', sequence, onCancel });
  const { step, errors } = wizard;
  const company = overview.scopeOptions.find((option) => option.id === legalEntityId);
  const roles = (Object.keys(roleLabels) as RoleCode[]).filter(
    (item) =>
      (item !== 'OWNER' || overview.canInviteOwner) &&
      (!forStation || scopeChoicesForRole(item).includes('STATION')),
  );

  function pickRole(next: RoleCode) {
    setRole(next);
    if (forStation) return;
    setScopeType(defaultScopeForRole(next));
    setStationIds([]);
    if (defaultScopeForRole(next) === 'TENANT') setLegalEntityId(onlyCompany);
  }

  const contactCheck = () =>
    method === 'EMAIL' ? checkInviteEmail(email) : checkInviteStaffNumber(staffNumber);

  function next() {
    if (step === 'name') return wizard.advance(checkInviteName(name), 'method', 'review');
    if (step === 'method') return wizard.advance({}, 'contact', 'review');
    if (step === 'contact') return wizard.advance(contactCheck(), 'role', 'review');
    if (step === 'role') {
      // A role that needs stations always goes on to ask which ones.
      return needsScope ? wizard.advance({}, 'scope') : wizard.advance({}, 'review', 'review');
    }
    if (step === 'scope') {
      return wizard.advance(checkInviteScope(scopeType, legalEntityId, stationIds), 'review');
    }
    const here = forStation !== undefined;
    onSubmit({
      name: name.trim(),
      deliveryMethod: method,
      email: email.trim(),
      staffNumber: staffNumber.trim(),
      role,
      scopeType: here ? 'STATION' : scopeType,
      legalEntityId: !here && scopeType === 'TENANT' ? '' : legalEntityId,
      stationIds: here ? [forStation.id] : scopeType === 'STATION' ? stationIds : [],
    });
  }

  const stationNames = (company?.stations ?? [])
    .filter((station) => stationIds.includes(station.id))
    .map((station) => station.name);
  const whereText = forStation
    ? forStation.name
    : scopeType === 'TENANT'
      ? 'Every station'
      : scopeType === 'LEGAL_ENTITY'
        ? `Whole company: ${company?.name ?? ''}`
        : `${company?.name ?? ''}: ${stationNames.join(', ')}`;

  return (
    <form
      className="form-stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {step === 'name' ? (
        <WizardStep
          wizard={wizard}
          title="Who are you inviting?"
          hint="Their full name, as you want it shown."
        >
          <Field id="inv-name" label="Full name" error={errors['inv-name']} required>
            <input
              id="inv-name"
              maxLength={160}
              autoComplete="off"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'method' ? (
        <WizardStep
          wizard={wizard}
          title="How will they sign in?"
          hint="Invitations expire after 72 hours and can be resent or cancelled."
        >
          <WizardChoices label="How they sign in">
            <WizardChoice
              name="inv-method"
              checked={method === 'MANUAL'}
              onPick={() => setMethod('MANUAL')}
              detail="You give them a staff number and a one-time code. No email needed."
            >
              With a staff number
            </WizardChoice>
            <WizardChoice
              name="inv-method"
              checked={method === 'EMAIL'}
              onPick={() => setMethod('EMAIL')}
              detail="We email them a link to set up their account."
            >
              With their email address
            </WizardChoice>
          </WizardChoices>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'contact' ? (
        <WizardStep
          wizard={wizard}
          title={method === 'EMAIL' ? 'What is their email address?' : 'Pick a staff number'}
          hint={
            method === 'EMAIL'
              ? 'The invitation is sent here.'
              : 'This is their login name. Leave it blank and we will make one for you.'
          }
        >
          {method === 'EMAIL' ? (
            <Field id="inv-email" label="Email address" error={errors['inv-email']} required>
              <input
                id="inv-email"
                type="email"
                maxLength={320}
                autoComplete="off"
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
          ) : (
            <Field
              id="inv-number"
              label="Staff number"
              hint="4 to 32 letters, numbers, hyphens or underscores."
              error={errors['inv-number']}
              optional
            >
              <input
                id="inv-number"
                maxLength={32}
                autoCapitalize="characters"
                autoComplete="off"
                autoFocus
                value={staffNumber}
                onChange={(event) => setStaffNumber(event.target.value)}
              />
            </Field>
          )}
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'role' ? (
        <WizardStep
          wizard={wizard}
          title="What will they do?"
          hint="This decides what they can see and do."
        >
          <Field id="inv-role" label="Role" required>
            <Select
              id="inv-role"
              value={role}
              onChange={(event) => pickRole(event.target.value as RoleCode)}
              options={roles.map((item) => ({ value: item, label: roleLabels[item] }))}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'scope' ? (
        <WizardStep
          wizard={wizard}
          title="Where will they work?"
          hint="They can only use the stations you choose."
        >
          {onlyCompany ? null : (
            <Field id="inv-company" label="Company" error={errors['inv-company']} required>
              <Select
                id="inv-company"
                value={legalEntityId}
                onChange={(event) => {
                  setLegalEntityId(event.target.value);
                  setStationIds([]);
                }}
                placeholder="Choose a company"
                options={overview.scopeOptions.map((option) => ({
                  value: option.id,
                  label: option.name,
                }))}
              />
            </Field>
          )}
          {scopeChoicesForRole(role).length > 1 ? (
            <WizardChoices label="Where they work">
              <WizardChoice
                name="inv-scope"
                checked={scopeType === 'LEGAL_ENTITY'}
                onPick={() => {
                  setScopeType('LEGAL_ENTITY');
                  setStationIds([]);
                }}
              >
                The whole company
              </WizardChoice>
              <WizardChoice
                name="inv-scope"
                checked={scopeType === 'STATION'}
                onPick={() => setScopeType('STATION')}
              >
                Only some stations
              </WizardChoice>
            </WizardChoices>
          ) : null}
          {scopeType === 'STATION' ? (
            <fieldset
              id="inv-stations"
              tabIndex={-1}
              className={styles.staffStations}
              aria-invalid={errors['inv-stations'] ? true : undefined}
            >
              <legend>Stations</legend>
              {company?.stations.length ? (
                company.stations.map((station) => (
                  <label key={station.id} className={styles.staffCheck}>
                    <input
                      type="checkbox"
                      checked={stationIds.includes(station.id)}
                      onChange={() =>
                        setStationIds((current) =>
                          current.includes(station.id)
                            ? current.filter((id) => id !== station.id)
                            : [...current, station.id],
                        )
                      }
                    />
                    <span>
                      {station.name} <small>{station.code}</small>
                      {station.setup ? <small> · Setting up</small> : null}
                    </span>
                  </label>
                ))
              ) : (
                <p className={styles.note}>Choose a company to see its stations.</p>
              )}
              {errors['inv-stations'] ? (
                <p className="field-error" role="alert">
                  {errors['inv-stations']}
                </p>
              ) : null}
            </fieldset>
          ) : null}
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check the invitation" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            <WizardSummaryRow label="Name" onChange={() => wizard.change('name')}>
              {name.trim()}
            </WizardSummaryRow>
            <WizardSummaryRow label="Signs in" onChange={() => wizard.change('method')}>
              {method === 'EMAIL' ? 'By email' : 'With a staff number'}
            </WizardSummaryRow>
            <WizardSummaryRow
              label={method === 'EMAIL' ? 'Email address' : 'Staff number'}
              onChange={() => wizard.change('contact')}
            >
              {method === 'EMAIL' ? email.trim() : staffNumber.trim() || 'Made for them'}
            </WizardSummaryRow>
            <WizardSummaryRow label="Role" onChange={() => wizard.change('role')}>
              {roleLabels[role]}
            </WizardSummaryRow>
            <WizardSummaryRow
              label="Works at"
              {...(needsScope ? { onChange: () => wizard.change('scope') } : {})}
            >
              {whereText}
            </WizardSummaryRow>
          </WizardSummary>
          <InfoTip>
            {method === 'EMAIL'
              ? 'We email them a link. It works for 72 hours.'
              : 'You will see their staff number and a one-time code once. Copy or print it then.'}
          </InfoTip>
          <WizardActions
            wizard={wizard}
            onContinue={next}
            continueLabel={method === 'EMAIL' ? 'Send invitation' : 'Create invitation'}
            busy={busy}
          />
        </WizardStep>
      ) : null}
    </form>
  );
}
