'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { useToast } from '@/design-system/feedback-provider';
import { Select } from '@/design-system/forms';
import { Modal } from '@/design-system/modal';
import { Button, ErrorState, Field } from '@/design-system/primitives';
import { StepUpDialog } from '../../setup/ui/step-up-dialog';
import type { SettingsLegalEntity, SettingsStation } from '../contracts';

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

export function AddCompany({ tenantId }: { tenantId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [registration, setRegistration] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const { send, busy, error, setError, dialog, waiting } = useSettingsCommand(tenantId, () => {
    setOpen(false);
    setName('');
    setRegistration('');
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFieldError(null);
    if (!name.trim()) return setFieldError('Enter the company name.');
    await send({
      commandType: 'CreateLegalEntity',
      tenantId,
      legalName: name.trim(),
      ...(registration.trim() ? { registrationReference: registration.trim() } : {}),
    });
  }

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
        presentation="side"
        size="sm"
        dismissible={!busy}
      >
        <form className="form-stack" onSubmit={submit} noValidate>
          {error ? <ErrorState title="This could not be saved" message={error} /> : null}
          <Field id="company-name" label="Company name" required>
            <input
              id="company-name"
              maxLength={240}
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field id="company-registration" label="Registration number" optional>
            <input
              id="company-registration"
              maxLength={120}
              autoComplete="off"
              value={registration}
              onChange={(event) => setRegistration(event.target.value)}
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
        onClick={() => {
          setName(company.name);
          setError(null);
          setOpen(true);
        }}
      >
        Edit {company.name}
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

export function AddStation({
  tenantId,
  companies,
}: {
  tenantId: string;
  companies: readonly SettingsLegalEntity[];
}) {
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState(companies.length === 1 ? companies[0]!.id : '');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [zone, setZone] = useState('Africa/Harare');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const { send, busy, error, setError, dialog, waiting } = useSettingsCommand(tenantId, () => {
    setOpen(false);
    setName('');
    setCode('');
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFieldError(null);
    if (!companyId) return setFieldError('Choose the company that runs this station.');
    if (!name.trim()) return setFieldError('Enter the station name.');
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{1,19}$/.test(code.trim())) {
      return setFieldError('Enter a short code of 2 to 20 letters or numbers, for example BND.');
    }
    await send({
      commandType: 'CreateStation',
      tenantId,
      legalEntityId: companyId,
      name: name.trim(),
      code: code.trim(),
      timezone: zone,
    });
  }

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
      {companies.length === 0 ? <p className="field-hint">Add a company first.</p> : null}
      <Modal
        open={open && !waiting}
        onClose={() => !busy && setOpen(false)}
        title="Add a station"
        presentation="side"
        size="sm"
        dismissible={!busy}
      >
        <form className="form-stack" onSubmit={submit} noValidate>
          {error ? <ErrorState title="This could not be saved" message={error} /> : null}
          {companies.length > 1 ? (
            <Field id="station-company" label="Company" required>
              <Select
                id="station-company"
                value={companyId}
                onChange={(event) => setCompanyId(event.target.value)}
                placeholder="Choose a company"
                options={companies.map((company) => ({ value: company.id, label: company.name }))}
              />
            </Field>
          ) : null}
          <Field id="station-name" label="Station name" required>
            <input
              id="station-name"
              maxLength={160}
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            id="station-code"
            label="Short code"
            hint="Letters and numbers, for example BND. It cannot be changed later."
            required
          >
            <input
              id="station-code"
              maxLength={20}
              autoComplete="off"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
          <ZoneField id="station-zone" value={zone} onChange={setZone} />
          <p className="field-hint">
            The station starts in setup. Add its fuels, tanks and pumps under Station setup, then
            switch it on.
          </p>
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

export function EditStation({ tenantId, station }: { tenantId: string; station: SettingsStation }) {
  const [open, setOpen] = useState(false);
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
      <Button
        variant="secondary"
        size="sm"
        aria-haspopup="dialog"
        onClick={() => {
          setName(station.name);
          setZone(station.timezone);
          setError(null);
          setOpen(true);
        }}
      >
        Edit {station.name}
      </Button>
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
