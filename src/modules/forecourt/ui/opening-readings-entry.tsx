'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { useToast } from '../../../design-system/feedback-provider';
import { NumericInput } from '../../../design-system/primitives';
import {
  WIZARD_REVIEW_HINT,
  WizardActions,
  WizardCard,
  WizardNotice,
  WizardStep,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
} from '../../../design-system/wizard';
import { WizardResumeNotice, useWizardDraft } from '../../../design-system/wizard-kit';
import { wizardDraftKey } from '../../../design-system/wizard-draft';
import { dailyOperationsProblem } from './daily-operations-state';
import {
  checkReading,
  pumpName,
  readingPosition,
  sortPumps,
  startingReadings,
  unpricedPumps,
} from './opening-readings-wizard';

type Pump = Readonly<{
  nozzleId: string;
  pumpNumber: string;
  nozzleNumber: string;
  productId: string;
  productName: string;
  sellingPriceId: string | null;
  previousReading: string | null;
}>;

type Props = Readonly<{
  tenantId: string;
  stationId: string;
  shiftId: string;
  reconciliationId: string;
  version: number;
  pumps: ReadonlyArray<Pump>;
}>;

type Screen = 'reading' | 'review';
const SCREENS: readonly Screen[] = ['reading', 'review'];

/**
 * Shown right after a shift opens: one pump meter per screen, then a check screen. The saved
 * opening readings are what the figures screen later shows, locked, beside the closing readings.
 */
export function OpeningReadingsEntry({
  tenantId,
  stationId,
  shiftId,
  reconciliationId,
  version,
  pumps,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const sorted = useMemo(() => sortPumps(pumps), [pumps]);
  const [values, setValues] = useState<Record<string, string>>(() => startingReadings(sorted));
  const [busy, setBusy] = useState(false);
  const home = `/operations/daily?${new URLSearchParams({ tenantId, stationId }).toString()}`;

  const wizard = useWizard<Screen>({
    start: 'reading',
    sequence: SCREENS,
    onCancel: () => router.push(home),
  });
  const onReview = wizard.step === 'review';
  const pump = sorted[wizard.index];
  const { position, total } = readingPosition(sorted.length, wizard.index, onReview);
  const shown = { ...wizard, position, total };
  const unpriced = unpricedPumps(sorted);

  // The readings typed so far survive a reload, and are offered back rather than applied.
  const draft = useWizardDraft<Screen, { values: Record<string, string> }>({
    key: wizardDraftKey(['opening-readings', tenantId, reconciliationId]),
    version: String(version),
    steps: SCREENS,
    wizard,
    answers: { values },
    onRestore: (saved) => setValues((current) => ({ ...current, ...saved.values })),
  });

  /** Moves on from one pump to the next, or to the check screen after the last. */
  function nextPump() {
    if (!pump) return;
    const checked = checkReading(values[pump.nozzleId] ?? '', pump);
    if (!checked.ok) {
      wizard.setErrors({ [`opening-${pump.nozzleId}`]: checked.message });
      wizard.setFocusId(`opening-${pump.nozzleId}`);
      return;
    }
    // Changed from the check screen: go straight back to it.
    if (wizard.trail[wizard.trail.length - 1]?.step === 'review') return wizard.back();
    if (wizard.index + 1 < sorted.length) wizard.go('reading', wizard.index + 1);
    else wizard.go('review', 0);
  }

  async function save() {
    const missing = sorted.find((item) => !checkReading(values[item.nozzleId] ?? '', item).ok);
    if (missing) {
      wizard.show('reading', sorted.indexOf(missing));
      wizard.setProblem(`Check the reading of ${pumpName(missing).toLowerCase()}.`);
      return;
    }
    if (unpriced[0]) {
      wizard.setProblem(
        `${unpriced[0].productName} has no selling price yet. Ask a manager to set it, then come back.`,
      );
      return;
    }
    setBusy(true);
    wizard.setProblem(null);
    try {
      const response = await fetch('/api/forecourt/commands', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `opening-readings-${reconciliationId}-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          commandType: 'SaveMeterReadings',
          tenantId,
          stationId,
          reconciliationId,
          expectedVersion: version,
          // The closing reading is not known yet; it is filled in when the figures are entered.
          readings: sorted.map((item) => {
            const opening = values[item.nozzleId]!.trim();
            return {
              nozzleId: item.nozzleId,
              productId: item.productId,
              shiftId,
              openingReading: opening,
              closingReading: opening,
              sellingPriceId: item.sellingPriceId,
            };
          }),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
          code?: string;
        };
        wizard.setProblem(dailyOperationsProblem(response.status, body.code, body.message).message);
        return;
      }
      draft.clear();
      toast.success('Opening readings saved. You can now enter the figures for this shift.');
      router.push(home);
      router.refresh();
    } catch {
      wizard.setProblem(
        'The readings could not be saved. Check your connection and press Save again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (sorted.length === 0) {
    return (
      <div className="daily-operations-workspace" aria-label="Opening readings">
        <WizardCard>
          <WizardStep
            wizard={{ position: 1, total: 0, captureHeading: wizard.captureHeading }}
            title="No pumps are set up yet"
            hint="A manager needs to set up the pumps for this station before readings can be entered."
          >
            <WizardActions
              wizard={wizard}
              onContinue={() => router.push(home)}
              continueLabel="Back"
            />
          </WizardStep>
        </WizardCard>
      </div>
    );
  }

  return (
    <div className="daily-operations-workspace" aria-label="Opening readings">
      <WizardCard ownDraft>
        <WizardResumeNotice offer={draft.offer} onResume={draft.resume} onDiscard={draft.discard} />
        {onReview ? (
          <WizardStep wizard={shown} title="Check the opening readings" hint={WIZARD_REVIEW_HINT}>
            <WizardSummary>
              {sorted.map((item, index) => (
                <WizardSummaryRow
                  key={item.nozzleId}
                  label={`${pumpName(item)} · ${item.productName}`}
                  onChange={() => wizard.change('reading', index)}
                >
                  {values[item.nozzleId]?.trim() || '—'} L
                </WizardSummaryRow>
              ))}
            </WizardSummary>
            {unpriced.length > 0 ? (
              <WizardNotice>
                {unpriced.map((item) => item.productName).join(' and ')} has no selling price yet.
                Ask a manager to set it before you save.
              </WizardNotice>
            ) : null}
            {wizard.problem ? (
              <p className="field-error" role="alert">
                {wizard.problem}
              </p>
            ) : null}
            <WizardActions
              wizard={wizard}
              continueLabel="Save opening readings"
              busy={busy}
              onContinue={() => void save()}
            />
          </WizardStep>
        ) : pump ? (
          <WizardStep
            wizard={shown}
            title={`What does the meter show on ${pumpName(pump).toLowerCase()}?`}
            hint={
              pump.previousReading
                ? `${pump.productName}. The last closing reading was ${pump.previousReading}. Change it if the meter shows something else.`
                : `${pump.productName}. Read the number on the pump meter now.`
            }
          >
            <NumericInput
              id={`opening-${pump.nozzleId}`}
              label="Opening reading"
              value={values[pump.nozzleId] ?? ''}
              error={wizard.errors[`opening-${pump.nozzleId}`]}
              onChange={(event) =>
                setValues((current) => ({ ...current, [pump.nozzleId]: event.target.value }))
              }
              unit="L"
              required
              autoComplete="off"
            />
            {wizard.problem ? (
              <p className="field-error" role="alert">
                {wizard.problem}
              </p>
            ) : null}
            <WizardActions
              wizard={wizard}
              continueLabel={wizard.index + 1 < sorted.length ? 'Continue' : 'Check readings'}
              onContinue={nextPump}
            />
          </WizardStep>
        ) : null}
      </WizardCard>
    </div>
  );
}
