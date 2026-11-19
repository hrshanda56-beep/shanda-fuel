'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { useToast } from '@/design-system/feedback-provider';
import { Select } from '@/design-system/forms';
import { Modal } from '@/design-system/modal';
import {
  WizardActions,
  WizardStep,
  WIZARD_REVIEW_HINT,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
} from '@/design-system/wizard';
import { Button, ErrorState, Field } from '@/design-system/primitives';
import { StepUpDialog } from '../../setup/ui/step-up-dialog';
import {
  checkCompanyName,
  checkStationCode,
  checkStationCompany,
  checkStationName,
  suggestStationCode,
} from '../structure-checks';
import type { SettingsLegalEntity, SettingsStation } from '../contracts';
import { InfoTip } from '@/design-system/info-tip';

const COMMON_ZONES = [
  'Africa/Harare',
  'Africa/Johannesburg',
  'Africa/Lusaka',
  'Africa/Maputo',
  'Africa/Gaborone',
  'Africa/Nairobi',
  'UTC',
];

/** Sends one settings command. A retry of the same form keeps its key, so it never saves twice. */
function useSettingsCommand(tenantId: string, onSaved: () => void) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Changing the business structure needs a fresh identity check; the form waits while it runs.
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  async function send(body: Record<string, unknown>, confirmed = false): Promise<boolean> {
    const fingerprint = JSON.stringify(body);
    if (attempt.current?.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/settings/commands', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': attempt.current.key },
        body: JSON.stringify(body),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof result === 'object' && result !== null && 'message' in result
            ? String((result as { message: unknown }).message)
            : 'This could not be saved.';
        throw new Error(message);
      }
      attempt.current = null;
      toast.success('Saved. Your change is now in effect.');
      onSaved();
      router.refresh();
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'This could not be saved.';
      if (!confirmed && /step-up/i.test(message)) {
        setRetry(() => () => void send(body, true));
      } else {
        setError(message);
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  const dialog = (
    <StepUpDialog
      open={retry !== null}
      tenantId={tenantId}
      description="This change needs a fresh identity check first. Nothing is saved until you confirm."
      confirmLabel="Confirm and continue"
      cancelledMessage="The check was cancelled or did not pass. Nothing was saved."
      onVerified={() => {
        const run = retry;
        setRetry(null);
        run?.();
      }}
      onCancel={() => {
        setRetry(null);
        setError('The identity check was cancelled, so nothing was saved.');
      }}
    />
  );

  return { send, busy, error, setError, dialog, waiting: retry !== null };
}

function ZoneField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const zones = COMMON_ZONES.includes(value) ? COMMON_ZONES : [value, ...COMMON_ZONES];
  return (
    <Field
      id={id}
      label="Time zone"
      hint="Shifts, days and reports at this station follow this clock."
      required
    >
      <Select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        options={zones.map((zone) => ({ value: zone, label: zone }))}
      />
    </Field>
  );
}

type CompanyStep = 'name' | 'registration' | 'review';
const COMPANY_STEPS: readonly CompanyStep[] = ['name', 'registration', 'review'];

function CompanyGuide({
  takenNames,
  busy,
  error,
  onCancel,
  onSave,
}: {
  takenNames: readonly string[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (name: string, registration: string) => void;
}) {
  const [name, setName] = useState('');
  const [registration, setRegistration] = useState('');
  const wizard = useWizard<CompanyStep>({ start: 'name', sequence: COMPANY_STEPS, onCancel });
  const { step, errors } = wizard;

  function next() {
    if (step === 'name')
      return wizard.advance(checkCompanyName(name, takenNames), 'registration', 'review');
    if (step === 'registration') return wizard.advance({}, 'review');
    onSave(name.trim(), registration.trim());
  }

  return (
    <form
      className="form-stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {error ? <ErrorState title="This could not be saved" message={error} /> : null}
      {step === 'name' ? (
        <WizardStep
          wizard={wizard}
          title="What is the company called?"
          hint="The name used on documents and reports."
        >
          <Field id="name" label="Company name" error={errors.name} required>
            <input
              id="name"
              maxLength={240}
              autoComplete="off"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'registration' ? (
        <WizardStep
          wizard={wizard}
          title="Does it have a registration number?"
          hint="You can leave this empty and add it later."
        >
          <Field id="registration" label="Registration number" optional>
            <input
              id="registration"
              maxLength={120}
              autoComplete="off"
              value={registration}
              onChange={(event) => setRegistration(event.target.value)}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check the company" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            <WizardSummaryRow label="Company" onChange={() => wizard.change('name')}>
              {name.trim()}
            </WizardSummaryRow>
            <WizardSummaryRow
              label="Registration number"
              onChange={() => wizard.change('registration')}
            >
              {registration.trim() || 'Not given'}
            </WizardSummaryRow>
          </WizardSummary>
          <WizardActions
            wizard={wizard}
            onContinue={next}
            continueLabel="Save company"
            busy={busy}
          />
        </WizardStep>
      ) : null}
    </form>
  );
}

export function AddCompany({
  tenantId,
  takenNames = [],
}: {
  tenantId: string;
  takenNames?: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const { send, busy, error, setError, dialog, waiting } = useSettingsCommand(tenantId, () =>
    setOpen(false),
  );

  return (
    <>
      <Button
        aria-haspopup="dialog"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        Add company
      </Button>
      <Modal
        open={open && !waiting}
        onClose={() => !busy && setOpen(false)}
        title="Add a company"
        presentation="page"
        backLabel="Companies"
        size="sm"
        dismissible={!busy}
      >
        {open ? (
          <CompanyGuide
            busy={busy}
            error={error}
            takenNames={takenNames}
            onCancel={() => setOpen(false)}
            onSave={(name, registration) =>
              void send({
                commandType: 'CreateLegalEntity',
                tenantId,
                legalName: name,
                ...(registration ? { registrationReference: registration } : {}),
              })
            }
          />
        ) : null}
      </Modal>
      {dialog}
    </>
  );
}

export function EditCompany({
  tenantId,
  company,
}: {
  tenantId: string;
  company: SettingsLegalEntity;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(company.name);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const { send, busy, error, setError, dialog, waiting } = useSettingsCommand(tenantId, () =>
    setOpen(false),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFieldError(null);
    if (!name.trim()) return setFieldError('Enter the company name.');
    await send({
      commandType: 'UpdateLegalEntity',
      tenantId,
      legalEntityId: company.id,
      legalName: name.trim(),
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-haspopup="dialog"
        aria-label={`Edit ${company.name}`}
        onClick={() => {
          setName(company.name);
          setError(null);
          setOpen(true);
        }}
      >
        Edit
      </Button>
      <Modal
        open={open && !waiting}
        onClose={() => !busy && setOpen(false)}
        title="Edit company"
        presentation="side"
        size="sm"
        dismissible={!busy}
      >
        <form className="form-stack" onSubmit={submit} noValidate>
          {error ? <ErrorState title="This could not be saved" message={error} /> : null}
          <Field id={`company-edit-${company.id}`} label="Company name" required>
            <input
              id={`company-edit-${company.id}`}
              maxLength={240}
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {fieldError ? (
            <p className="field-error" role="alert">
              {fieldError}
            </p>
          ) : null}
          <div className="form-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Save company
            </Button>
          </div>
        </form>
      </Modal>
      {dialog}
    </>
  );
}

type StationStep = 'company' | 'name' | 'code' | 'zone' | 'review';

function StationGuide({
  companies,
  takenCodes,
  busy,
  error,
  onCancel,
  onSave,
}: {
  companies: readonly SettingsLegalEntity[];
  takenCodes: readonly string[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (value: { companyId: string; name: string; code: string; zone: string }) => void;
}) {
  const onlyCompany = companies.length === 1 ? companies[0]!.id : '';
  const [companyId, setCompanyId] = useState(onlyCompany);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeEdited, setCodeEdited] = useState(false);
  const [zone, setZone] = useState('Africa/Harare');
  // With one company there is nothing to choose, so that question is left out.
  const sequence: readonly StationStep[] = onlyCompany
    ? ['name', 'code', 'zone', 'review']
    : ['company', 'name', 'code', 'zone', 'review'];
  const wizard = useWizard<StationStep>({
    start: sequence[0]!,
    sequence,
    onCancel,
  });
  const { step, errors } = wizard;
  const companyName = companies.find((company) => company.id === companyId)?.name ?? '';

  function next() {
    if (step === 'company') return wizard.advance(checkStationCompany(companyId), 'name', 'review');
    if (step === 'name') {
      const found = checkStationName(name);
      if (Object.keys(found).length === 0 && !codeEdited) {
        setCode(suggestStationCode(name, takenCodes));
      }
      return wizard.advance(found, 'code', 'review');
    }
    if (step === 'code')
      return wizard.advance(checkStationCode(code, takenCodes), 'zone', 'review');
    if (step === 'zone') return wizard.advance({}, 'review');
    onSave({ companyId, name: name.trim(), code: code.trim(), zone });
  }

  return (
    <form
      className="form-stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {error ? <ErrorState title="This could not be saved" message={error} /> : null}
      {step === 'company' ? (
        <WizardStep
          wizard={wizard}
          title="Which company runs this station?"
          hint="Each station belongs to one company."
        >
          <Field id="company" label="Company" error={errors.company} required>
            <Select
              id="company"
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
              placeholder="Choose a company"
              options={companies.map((company) => ({ value: company.id, label: company.name }))}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'name' ? (
        <WizardStep
          wizard={wizard}
          title="What is the station called?"
          hint="The name your team will see."
        >
          <Field id="name" label="Station name" error={errors.name} required>
            <input
              id="name"
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
      {step === 'code' ? (
        <WizardStep
          wizard={wizard}
          title="Pick a short code"
          hint="Letters and numbers, for example BND. It cannot be changed later."
        >
          <Field id="code" label="Short code" error={errors.code} required>
            <input
              id="code"
              maxLength={20}
              autoComplete="off"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setCodeEdited(true);
              }}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'zone' ? (
        <WizardStep wizard={wizard} title="Which time zone is the station in?">
          <ZoneField id="zone" value={zone} onChange={setZone} />
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check the station" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            {onlyCompany ? null : (
              <WizardSummaryRow label="Company" onChange={() => wizard.change('company')}>
                {companyName}
              </WizardSummaryRow>
            )}
            <WizardSummaryRow label="Station" onChange={() => wizard.change('name')}>
              {name.trim()}
            </WizardSummaryRow>
            <WizardSummaryRow label="Short code" onChange={() => wizard.change('code')}>
              {code.trim().toUpperCase()}
            </WizardSummaryRow>
            <WizardSummaryRow label="Time zone" onChange={() => wizard.change('zone')}>
              {zone}
            </WizardSummaryRow>
          </WizardSummary>
          <InfoTip>
            The station starts in setup. Press Station setup next to it to add its fuels, tanks and
            pumps, then switch it on.
          </InfoTip>
          <WizardActions
            wizard={wizard}
            onContinue={next}
            continueLabel="Save station"
            busy={busy}
          />
        </WizardStep>
      ) : null}
    </form>
  );
}

export function AddStation({
  tenantId,
  companies,
  takenCodes = [],
}: {
  tenantId: string;
  companies: readonly SettingsLegalEntity[];
  takenCodes?: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const { send, busy, error, setError, dialog, waiting } = useSettingsCommand(tenantId, () =>
    setOpen(false),
  );

  return (
    <>
      <Button
        aria-haspopup="dialog"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={companies.length === 0}
      >
        Add station
      </Button>
      <Modal
        open={open && !waiting}
        onClose={() => !busy && setOpen(false)}
        title="Add a station"
        presentation="page"
        backLabel="Stations"
        size="sm"
        dismissible={!busy}
      >
        {open ? (
          <StationGuide
            companies={companies}
            takenCodes={takenCodes}
            busy={busy}
            error={error}
            onCancel={() => setOpen(false)}
            onSave={(value) =>
              void send({
                commandType: 'CreateStation',
                tenantId,
                legalEntityId: value.companyId,
                name: value.name,
                code: value.code,
                timezone: value.zone,
              })
            }
          />
        ) : null}
      </Modal>
      {dialog}
    </>
  );
}

export function EditStation({
  tenantId,
  station,
  controlled,
}: {
  tenantId: string;
  station: SettingsStation;
  /** When given, the dialog is opened from elsewhere (a menu) and no button is shown here. */
  controlled?: { open: boolean; onOpenChange: (open: boolean) => void };
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlled ? controlled.open : ownOpen;
  const setOpen = (next: boolean) => {
    if (controlled) controlled.onOpenChange(next);
    else setOwnOpen(next);
  };
  const [name, setName] = useState(station.name);
  const [zone, setZone] = useState(station.timezone);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const { send, busy, error, setError, dialog, waiting } = useSettingsCommand(tenantId, () =>
    setOpen(false),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFieldError(null);
    if (!name.trim()) return setFieldError('Enter the station name.');
    await send({
      commandType: 'UpdateStation',
      tenantId,
      stationId: station.id,
      name: name.trim(),
      timezone: zone,
    });
  }

  return (
    <>
      {controlled ? null : (
        <Button
          variant="secondary"
          size="sm"
          aria-haspopup="dialog"
          aria-label={`Edit ${station.name}`}
          onClick={() => {
            setName(station.name);
            setZone(station.timezone);
            setError(null);
            setOpen(true);
          }}
        >
          Edit
        </Button>
      )}
      <Modal
        open={open && !waiting}
        onClose={() => !busy && setOpen(false)}
        title="Edit station"
        presentation="side"
        size="sm"
        dismissible={!busy}
      >
        <form className="form-stack" onSubmit={submit} noValidate>
          {error ? <ErrorState title="This could not be saved" message={error} /> : null}
          <Field id={`station-edit-${station.id}`} label="Station name" required>
            <input
              id={`station-edit-${station.id}`}
              maxLength={160}
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <ZoneField id={`station-zone-${station.id}`} value={zone} onChange={setZone} />
          {fieldError ? (
            <p className="field-error" role="alert">
              {fieldError}
            </p>
          ) : null}
          <div className="form-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Save station
            </Button>
          </div>
        </form>
      </Modal>
      {dialog}
    </>
  );
}
