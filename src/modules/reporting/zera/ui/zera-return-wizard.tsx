'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Select } from '@/design-system/forms';
import { Button, Card, ErrorState, Field } from '@/design-system/primitives';
import { WizardOptions } from '@/design-system/wizard-kit';
import {
  WIZARD_REVIEW_HINT,
  WizardActions,
  WizardNotice,
  WizardPair,
  WizardStep,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
} from '@/design-system/wizard';
import type { ReturnViewJson, SavedSummary } from './types';
import {
  ZERA_OWNERSHIPS,
  ZERA_OWNERSHIP_LABELS,
  ZERA_PROVINCES,
  type StationZeraDetails,
  type ZeraOwnership,
  type ZeraProvince,
} from '../zera-licence';
import {
  checkContact,
  checkLicenceHolder,
  checkLicenceNumber,
  monthName,
  zeraAnswers,
  zeraDueDate,
  zeraSteps,
  type ZeraStep,
} from '../zera-wizard-checks';

type Props = {
  tenantId: string;
  stations: readonly { id: string; name: string }[];
  months: readonly { value: string; label: string }[];
};

type Answered = Partial<Record<'holder' | 'number' | 'ownership' | 'province' | 'contact', true>>;

const ETHANOL_CHOICES = [
  { value: '0', label: 'No ethanol blend' },
  { value: '5', label: '5%' },
  { value: '10', label: '10%' },
  { value: '15', label: '15%' },
  { value: '20', label: '20%' },
];

/** Which screen changes each answer on the check screen (by position in the form's own order). */
const CHANGE_STEP: Record<number, ZeraStep> = {
  0: 'contact',
  1: 'contact',
  2: 'contact',
  3: 'holder',
  4: 'ownership',
  5: 'number',
  7: 'province',
  10: 'ethanol',
  13: 'notes',
};

function PastReturns({
  returns,
  months,
  onDownload,
}: {
  returns: readonly SavedSummary[];
  months: Props['months'];
  onDownload: (month: string, format: 'csv' | 'pdf', version: number) => void;
}) {
  if (returns.length === 0) return null;
  return (
    <Card>
      <h3>Returns already saved for this station</h3>
      <ul className="form-stack">
        {returns.map((entry) => (
          <li key={entry.id}>
            <strong>
              {months.find((m) => m.value === entry.month)?.label ??
                `${monthName(entry.month)} ${entry.month.slice(0, 4)}`}
            </strong>{' '}
            · version {entry.version} · saved {entry.savedAt.slice(0, 10)}{' '}
            <Button
              type="button"
              variant="quiet"
              size="sm"
              aria-label={`Download CSV, ${entry.month} version ${entry.version}`}
              onClick={() => onDownload(entry.month, 'csv', entry.version)}
            >
              CSV
            </Button>{' '}
            <Button
              type="button"
              variant="quiet"
              size="sm"
              aria-label={`Download PDF, ${entry.month} version ${entry.version}`}
              onClick={() => onDownload(entry.month, 'pdf', entry.version)}
            >
              PDF
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ZeraReturnWizard({ tenantId, stations, months }: Props) {
  const router = useRouter();
  const [month, setMonth] = useState(months[0]?.value ?? '');
  const [stationId, setStationId] = useState<string | null>(
    stations.length === 1 ? (stations[0]?.id ?? null) : null,
  );
  const [view, setView] = useState<ReturnViewJson | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [holder, setHolder] = useState('');
  const [number, setNumber] = useState('');
  const [ownership, setOwnership] = useState<ZeraOwnership | null>(null);
  const [province, setProvince] = useState<ZeraProvince | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [ethanol, setEthanol] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pastReturns, setPastReturns] = useState<SavedSummary[]>([]);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [answered, setAnswered] = useState<Answered>({});
  const [copied, setCopied] = useState<string | null>(null);

  const result = view?.result ?? null;
  const ethanolPercent = ethanol !== null ? Number(ethanol) : (result?.ethanolPercent ?? null);
  const petrolInUse = result ? result.petrol.supplied !== '0' || result.petrol.sold !== '0' : false;
  const needsEthanol =
    petrolInUse && result !== null && result.ethanolPercent === null && ethanol === null;
  const steps = zeraSteps({
    stationCount: stations.length,
    details: view?.details ?? null,
    result,
    answered,
    needsEthanol: needsEthanol || (ethanol !== null && result?.ethanolPercent === null),
  });
  const wizard = useWizard<ZeraStep>({
    start: 'month',
    sequence: steps,
    onCancel: () => router.push(`/reports?tenantId=${encodeURIComponent(tenantId)}`),
  });
  const { step, errors } = wizard;

  const monthLabel = months.find((m) => m.value === month)?.label ?? month;
  const stationName = view?.stationName ?? stations.find((s) => s.id === stationId)?.name ?? '';
  const due = zeraDueDate(month);
  const details: StationZeraDetails = {
    licenceHolder: holder.trim() || null,
    licenceNumber: number.trim() || null,
    ownership,
    province,
    representativeName: contactName.trim() || null,
    representativePhone: contactPhone.trim() || null,
    representativeEmail: contactEmail.trim() || null,
  };

  async function loadPast(forStation: string) {
    try {
      const query = new URLSearchParams({ tenantId, stationId: forStation });
      const response = await fetch(`/api/reports/zera/saved?${query}`, {
        credentials: 'same-origin',
      });
      setPastReturns(response.ok ? ((await response.json()) as SavedSummary[]) : []);
    } catch {
      setPastReturns([]);
    }
  }

  async function load(forStation: string): Promise<ReturnViewJson | null> {
    setLoading(true);
    setLoadError(null);
    try {
      const query = new URLSearchParams({ tenantId, stationId: forStation, month });
      const response = await fetch(`/api/reports/zera?${query}`, { credentials: 'same-origin' });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof body === 'object' && body !== null && 'message' in body
            ? String((body as { message: unknown }).message)
            : 'The figures could not be read.';
        throw new Error(message);
      }
      const loaded = body as ReturnViewJson;
      setView(loaded);
      setHolder(loaded.details.licenceHolder ?? '');
      setNumber(loaded.details.licenceNumber ?? '');
      setOwnership(loaded.details.ownership);
      setProvince(loaded.details.province);
      setContactName(loaded.details.representativeName ?? '');
      setContactPhone(loaded.details.representativePhone ?? '');
      setContactEmail(loaded.details.representativeEmail ?? '');
      setEthanol(null);
      setAnswered({});
      void loadPast(forStation);
      return loaded;
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'The figures could not be read.');
      return null;
    } finally {
      setLoading(false);
    }
  }

  /** Goes to the screen after `from`, using the steps that apply to freshly loaded figures. */
  function goAfter(from: ZeraStep, loaded: ReturnViewJson) {
    const fresh = zeraSteps({
      stationCount: stations.length,
      details: loaded.details,
      result: loaded.result,
      needsEthanol:
        (loaded.result.petrol.supplied !== '0' || loaded.result.petrol.sold !== '0') &&
        loaded.result.ethanolPercent === null,
    });
    const to = fresh[fresh.indexOf(from) + 1] ?? 'review';
    wizard.advance({}, to);
  }

  const after = (from: ZeraStep): ZeraStep => steps[steps.indexOf(from) + 1] ?? 'review';

  async function next() {
    if (step === 'month') {
      if (!month) return wizard.advance({ month: 'Choose a month.' }, 'station');
      if (stations.length === 1 && stationId) {
        const loaded = await load(stationId);
        if (loaded) goAfter('month', loaded);
        return;
      }
      return wizard.advance({}, 'station');
    }
    if (step === 'station') {
      if (!stationId) return wizard.advance({ station: 'Choose a station.' }, 'holder');
      const loaded = await load(stationId);
      if (loaded) goAfter('station', loaded);
      return;
    }
    if (step === 'holder') {
      return wizard.advance(checkLicenceHolder(holder), after('holder'), 'review');
    }
    if (step === 'number') {
      return wizard.advance(checkLicenceNumber(number), after('number'), 'review');
    }
    if (step === 'ownership') {
      return wizard.advance(
        ownership ? {} : { ownership: 'Choose one.' },
        after('ownership'),
        'review',
      );
    }
    if (step === 'province') {
      return wizard.advance(
        province ? {} : { province: 'Choose the province.' },
        after('province'),
        'review',
      );
    }
    if (step === 'contact') {
      return wizard.advance(
        checkContact(contactName, contactPhone, contactEmail),
        after('contact'),
        'review',
      );
    }
    if (step === 'ethanol') {
      return wizard.advance(
        ethanol === null ? { ethanol: 'Choose one.' } : {},
        after('ethanol'),
        'review',
      );
    }
    if (step === 'problems') {
      if (result && result.blockers.length > 0) {
        return wizard.advance(
          { problems: 'Set the fuel type for the products listed above first.' },
          'notes',
        );
      }
      return wizard.advance({}, 'notes');
    }
    if (step === 'notes') return wizard.advance({}, 'review', 'review');
    await finish();
  }

  /** Opens one question from the check screen, then comes straight back to it. */
  function change(to: ZeraStep) {
    if (to === 'holder' || to === 'number' || to === 'ownership' || to === 'province') {
      setAnswered((current) => ({ ...current, [to]: true }));
    }
    if (to === 'contact') setAnswered((current) => ({ ...current, contact: true }));
    wizard.change(to);
  }

  async function finish() {
    if (!view || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch('/api/reports/zera/saved', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          tenantId,
          stationId: view.stationId,
          month,
          ...(ethanol !== null ? { ethanolPercent: Number(ethanol) } : {}),
          notes: notes.trim(),
          details: {
            licenceHolder: details.licenceHolder ?? '',
            licenceNumber: details.licenceNumber ?? '',
            ownership: details.ownership,
            province: details.province,
            representativeName: details.representativeName ?? '',
            representativePhone: details.representativePhone ?? '',
            representativeEmail: details.representativeEmail ?? '',
          },
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        throw new Error(
          typeof body === 'object' && body !== null && 'message' in body
            ? String((body as { message: unknown }).message)
            : 'The return could not be saved.',
        );
      }
      setSavedVersion((body as { version: number }).version);
      void loadPast(view.stationId);
      wizard.go('done');
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'The return could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const answers = result
    ? zeraAnswers({ month, details, ethanolPercent, result, extraNotes: notes })
    : [];

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied(null);
    }
  }

  /** Downloads a saved return. Data leaving the app needs a fresh identity check, asked for silently first. */
  async function download(forMonth: string, format: 'csv' | 'pdf', version: number) {
    if (!view) return;
    setDownloadError(null);
    const query = new URLSearchParams({
      tenantId,
      stationId: view.stationId,
      month: forMonth,
      format,
      version: String(version),
    });
    const attempt = () =>
      fetch(`/api/reports/zera/download?${query}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
    let response = await attempt();
    if (response.status === 403) {
      const confirmed = await fetch('/api/auth/step-up', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, action: 'PRIVILEGED_OPERATION', silent: true }),
      }).catch(() => null);
      if (confirmed?.ok) response = await attempt();
    }
    if (!response.ok) {
      let message = 'The download could not be created.';
      try {
        message = ((await response.json()) as { message?: string }).message || message;
      } catch {
        // keep the plain message
      }
      setDownloadError(message);
      return;
    }
    const disposition = response.headers.get('content-disposition') ?? '';
    const filename =
      /filename="([^"]+)"/.exec(disposition)?.[1] ?? `zera-return-${forMonth}.${format}`;
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <form
      className="form-stack"
      noValidate
      aria-label="ZERA return"
      onSubmit={(event) => {
        event.preventDefault();
        void next();
      }}
    >
      {loadError ? <ErrorState title="The figures could not be read" message={loadError} /> : null}
      {saveError ? <ErrorState title="This could not be saved" message={saveError} /> : null}
      {downloadError ? (
        <ErrorState title="The download could not be created" message={downloadError} />
      ) : null}

      {step === 'month' ? (
        <WizardStep
          wizard={wizard}
          title="Which month is the return for?"
          hint="Most people file for last month. ZERA wants it by the 3rd of the month after."
        >
          <Field id="month" label="Month" error={errors.month} required>
            <Select
              id="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              options={months.map((m) => ({ value: m.value, label: m.label }))}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={() => void next()} busy={loading} />
        </WizardStep>
      ) : null}

      {step === 'station' ? (
        <WizardStep
          wizard={wizard}
          title="Which station is it for?"
          hint="Each station files its own return."
        >
          <WizardOptions
            label="Station"
            name="station"
            options={stations.map((s) => ({ value: s.id, label: s.name }))}
            value={stationId}
            onPick={setStationId}
          />
          {errors.station ? <p role="alert">{errors.station}</p> : null}
          <WizardActions wizard={wizard} onContinue={() => void next()} busy={loading} />
        </WizardStep>
      ) : null}

      {step === 'holder' ? (
        <WizardStep
          wizard={wizard}
          title="What name is on the licence?"
          hint="Exactly as it is written on the ZERA licence. We keep it for next month."
        >
          <Field id="holder" label="Name on the licence" error={errors.holder} required>
            <input
              id="holder"
              maxLength={240}
              autoComplete="off"
              autoFocus
              value={holder}
              onChange={(event) => setHolder(event.target.value)}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={() => void next()} />
        </WizardStep>
      ) : null}

      {step === 'number' ? (
        <WizardStep wizard={wizard} title="What is the licence number?">
          <Field id="number" label="Licence number" error={errors.number} required>
            <input
              id="number"
              maxLength={60}
              autoComplete="off"
              autoFocus
              value={number}
              onChange={(event) => setNumber(event.target.value)}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={() => void next()} />
        </WizardStep>
      ) : null}

      {step === 'ownership' ? (
        <WizardStep wizard={wizard} title="Who owns and runs the station?">
          <WizardOptions
            label="Ownership"
            name="ownership"
            options={ZERA_OWNERSHIPS.map((value) => ({
              value,
              label: value,
              detail: ZERA_OWNERSHIP_LABELS[value],
            }))}
            value={ownership}
            onPick={setOwnership}
          />
          {errors.ownership ? <p role="alert">{errors.ownership}</p> : null}
          <WizardActions wizard={wizard} onContinue={() => void next()} />
        </WizardStep>
      ) : null}

      {step === 'province' ? (
        <WizardStep wizard={wizard} title="Which province is the station in?">
          <Field id="province" label="Province" error={errors.province} required>
            <Select
              id="province"
              value={province ?? ''}
              onChange={(event) => setProvince((event.target.value || null) as ZeraProvince | null)}
              options={[
                { value: '', label: 'Choose a province' },
                ...ZERA_PROVINCES.map((name) => ({ value: name, label: name })),
              ]}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={() => void next()} />
        </WizardStep>
      ) : null}

      {step === 'contact' ? (
        <WizardStep
          wizard={wizard}
          title="Who should ZERA contact?"
          hint="A person at the station, with a phone number and email they can be reached on."
        >
          <Field id="contactName" label="Name" error={errors.contactName} required>
            <input
              id="contactName"
              maxLength={160}
              autoComplete="off"
              autoFocus
              value={contactName}
              onChange={(event) => setContactName(event.target.value)}
            />
          </Field>
          <WizardPair>
            <Field id="contactPhone" label="Phone number" error={errors.contactPhone} required>
              <input
                id="contactPhone"
                type="tel"
                maxLength={40}
                autoComplete="off"
                value={contactPhone}
                onChange={(event) => setContactPhone(event.target.value)}
              />
            </Field>
            <Field id="contactEmail" label="Email address" error={errors.contactEmail} required>
              <input
                id="contactEmail"
                type="email"
                maxLength={254}
                autoComplete="off"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
              />
            </Field>
          </WizardPair>
          <WizardActions wizard={wizard} onContinue={() => void next()} />
        </WizardStep>
      ) : null}

      {step === 'ethanol' ? (
        <WizardStep
          wizard={wizard}
          title="What is the ethanol percentage of your blended petrol?"
          hint={
            result && result.ethanolChoices.length > 1
              ? 'More than one blend was sold. Choose the one the return should show.'
              : 'We could not tell from your fuel setup. Choose one.'
          }
        >
          <WizardOptions
            label="Ethanol percentage"
            name="ethanol"
            options={ETHANOL_CHOICES}
            value={ethanol}
            onPick={setEthanol}
          />
          {errors.ethanol ? <p role="alert">{errors.ethanol}</p> : null}
          <WizardActions wizard={wizard} onContinue={() => void next()} />
        </WizardStep>
      ) : null}

      {step === 'problems' && result ? (
        <WizardStep
          wizard={wizard}
          title="Something needs your attention"
          hint="We never guess. These are shown on the return as they are."
        >
          {result.blockers.length > 0 ? (
            <WizardNotice>
              These products have no fuel type, so we cannot tell which box they belong in:{' '}
              {result.blockers.map((b) => b.productName).join(', ')}. Set the type under{' '}
              <Link href={`/stations?tenantId=${encodeURIComponent(tenantId)}`}>Fuels</Link>, then
              come back.
            </WizardNotice>
          ) : null}
          {result.missingDays.length > 0 ? (
            <WizardNotice>
              {result.missingDays.length} day(s) have no approved report:{' '}
              {result.missingDays.join(', ')}. Sold litres will show <strong>m</strong> (missing)
              until they are approved.
            </WizardNotice>
          ) : null}
          {errors.problems ? <p role="alert">{errors.problems}</p> : null}
          <WizardActions
            wizard={wizard}
            onContinue={() => void next()}
            continueLabel={result.blockers.length > 0 ? 'Continue' : 'Continue with m'}
          />
        </WizardStep>
      ) : null}

      {step === 'notes' ? (
        <WizardStep
          wizard={wizard}
          title="Anything to add in the notes?"
          hint="Optional. Fuels that do not belong in a box are already listed for you."
        >
          <Field id="notes" label="Notes">
            <textarea
              id="notes"
              rows={4}
              maxLength={500}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={() => void next()} />
        </WizardStep>
      ) : null}

      {step === 'review' && result ? (
        <>
          <WizardStep wizard={wizard} title="Check the return" hint={WIZARD_REVIEW_HINT}>
            <p className="field-hint">
              {monthLabel} · {stationName} · send to ZERA by {due.label}. Saving keeps this version;
              a later change is saved as a new version.
            </p>
            <WizardSummary>
              {answers.map((answer, position) => {
                const target = CHANGE_STEP[position];
                // Ethanol is only a question when it was asked.
                const changeable =
                  target && (target !== 'ethanol' || steps.includes('ethanol')) ? target : null;
                return (
                  <WizardSummaryRow
                    key={answer.label}
                    label={answer.label}
                    onChange={changeable ? () => change(changeable) : undefined}
                  >
                    {answer.value || 'Not given'}
                  </WizardSummaryRow>
                );
              })}
            </WizardSummary>
            <WizardActions
              wizard={wizard}
              onContinue={() => void next()}
              continueLabel="Save this return"
              busy={saving}
            />
          </WizardStep>
          <PastReturns returns={pastReturns} months={months} onDownload={download} />
        </>
      ) : null}

      {step === 'done' && result ? (
        <>
          <Card>
            <h2>
              ZERA return for {monthLabel}, {stationName}
            </h2>
            <p role="status">
              Saved as version {savedVersion}. Send it to ZERA by {due.label}. Copy each answer into
              the ZERA form, or download the saved return.
            </p>
            <ul className="form-stack">
              {answers.map((answer) => (
                <li key={answer.label}>
                  <strong>{answer.label}:</strong> {answer.value || 'Not given'}{' '}
                  <Button
                    type="button"
                    variant="quiet"
                    size="sm"
                    aria-label={`Copy ${answer.label}`}
                    onClick={() => void copy(answer.label, answer.value)}
                  >
                    {copied === answer.label ? 'Copied' : 'Copy'}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
          <PastReturns returns={pastReturns} months={months} onDownload={download} />
        </>
      ) : null}
    </form>
  );
}
