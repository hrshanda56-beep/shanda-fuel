'use client';

import { useState } from 'react';
import { Select } from '@/design-system/forms';
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
import { STAFF_ROLE_HINTS } from '../staff-role-labels';
import { checkInviteScope } from '../staff-invite-checks';
import styles from './settings-workspace.module.css';

/** Only what the guide reads: who may be made an owner, and the companies and stations on offer. */
type StaffOverview = Pick<NonNullable<SettingsView['staff']>, 'canInviteOwner' | 'scopeOptions'>;
type Scope = 'TENANT' | 'LEGAL_ENTITY' | 'STATION';
type AccessStep = 'role' | 'scope' | 'review';

export type StaffAccessValue = {
  role: RoleCode;
  scopeType: Scope;
  legalEntityId: string;
  stationIds: string[];
};

/** Change one person's role and stations, one question at a time, ending in a check screen. */
export function StaffAccessWizard({
  name,
  overview,
  roleLabels,
  initial,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  name: string;
  overview: StaffOverview;
  roleLabels: Record<RoleCode, string>;
  initial: StaffAccessValue;
  busy: boolean;
  error: string | undefined;
  onCancel: () => void;
  onSubmit: (value: StaffAccessValue) => void;
}) {
  const [role, setRole] = useState<RoleCode>(initial.role);
  const [scopeType, setScopeType] = useState<Scope>(initial.scopeType);
  const onlyCompany = overview.scopeOptions.length === 1 ? overview.scopeOptions[0]!.id : '';
  const [legalEntityId, setLegalEntityId] = useState(initial.legalEntityId || onlyCompany);
  const [stationIds, setStationIds] = useState<string[]>(initial.stationIds);

  const needsScope = defaultScopeForRole(role) !== 'TENANT';
  const sequence: readonly AccessStep[] = [
    'role',
    ...(needsScope ? (['scope'] as const) : []),
    'review',
  ];
  const wizard = useWizard<AccessStep>({ start: 'role', sequence, onCancel });
  const { step, errors } = wizard;
  const company = overview.scopeOptions.find((option) => option.id === legalEntityId);
  const roles = (Object.keys(roleLabels) as RoleCode[]).filter(
    (item) => item !== 'OWNER' || overview.canInviteOwner || item === initial.role,
  );

  function pickRole(next: RoleCode) {
    setRole(next);
    setScopeType(defaultScopeForRole(next));
    setStationIds([]);
    if (defaultScopeForRole(next) === 'TENANT') setLegalEntityId(onlyCompany);
  }

  function next() {
    if (step === 'role') {
      // A role that needs stations always goes on to ask which ones.
      return needsScope ? wizard.advance({}, 'scope') : wizard.advance({}, 'review', 'review');
    }
    if (step === 'scope') {
      return wizard.advance(checkInviteScope(scopeType, legalEntityId, stationIds), 'review');
    }
    onSubmit({
      role,
      scopeType,
      legalEntityId: scopeType === 'TENANT' ? '' : legalEntityId,
      stationIds: scopeType === 'STATION' ? stationIds : [],
    });
  }

  const stationNames = (company?.stations ?? [])
    .filter((station) => stationIds.includes(station.id))
    .map((station) => station.name);
  const whereText =
    scopeType === 'TENANT'
      ? 'Every station'
      : scopeType === 'LEGAL_ENTITY'
        ? `Whole company: ${company?.name ?? ''}`
        : `${company?.name ?? ''}: ${stationNames.join(', ')}`;

  return (
    <form
      className="form-stack"
      noValidate
      aria-label={`Edit access for ${name}`}
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {step === 'role' ? (
        <WizardStep
          wizard={wizard}
          title={`What will ${name} do?`}
          hint={`${STAFF_ROLE_HINTS[role]} It takes effect straight away.`}
        >
          <Field id="access-role" label="Role" required>
            <Select
              id="access-role"
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
                name="access-scope"
                checked={scopeType === 'LEGAL_ENTITY'}
                onPick={() => {
                  setScopeType('LEGAL_ENTITY');
                  setStationIds([]);
                }}
              >
                The whole company
              </WizardChoice>
              <WizardChoice
                name="access-scope"
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
        <WizardStep wizard={wizard} title="Check the new access" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            <WizardSummaryRow label="Person">{name}</WizardSummaryRow>
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
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <WizardActions
            wizard={wizard}
            onContinue={next}
            continueLabel="Save changes"
            busy={busy}
          />
        </WizardStep>
      ) : null}
    </form>
  );
}
