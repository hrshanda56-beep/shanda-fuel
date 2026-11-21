'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Checkbox } from './forms';
import { Button } from './primitives';
import {
  WizardChoice,
  WizardChoices,
  WizardStep,
  WizardSummary,
  WizardSummaryRow,
  type Wizard,
} from './wizard';
import {
  clearWizardDraft,
  loadWizardDraft,
  saveWizardDraft,
  type WizardDraft,
} from './wizard-draft';
import styles from './wizard.module.css';

/**
 * The ready-made parts that sit on top of `useWizard`: pick-list answers, the "change something
 * else?" loop, saving progress and the one confirm screen. Use these before reaching for a text box
 * or writing a new dialog.
 */

/* Pick, don't type ------------------------------------------------------------ */

export type WizardOption<V extends string = string> = {
  value: V;
  label: ReactNode;
  detail?: ReactNode;
};

/** A list of big answers where exactly one is picked. The first screen of a flow often is one. */
export function WizardOptions<V extends string>({
  label,
  name,
  options,
  value,
  onPick,
}: {
  label: string;
  name: string;
  options: readonly WizardOption<V>[];
  value: V | null;
  onPick: (value: V) => void;
}) {
  return (
    <WizardChoices label={label}>
      {options.map((option) => (
        <WizardChoice
          key={option.value}
          id={`${name}-${option.value}`}
          name={name}
          checked={value === option.value}
          onPick={() => onPick(option.value)}
          detail={option.detail}
        >
          {option.label}
        </WizardChoice>
      ))}
    </WizardChoices>
  );
}

/** Yes or no. `null` means not answered yet, so neither is pre-picked. */
export function WizardYesNo({
  label,
  name,
  value,
  onPick,
  yesLabel = 'Yes',
  noLabel = 'No',
  yesDetail,
  noDetail,
}: {
  label: string;
  name: string;
  value: boolean | null;
  onPick: (value: boolean) => void;
  yesLabel?: ReactNode;
  noLabel?: ReactNode;
  yesDetail?: ReactNode;
  noDetail?: ReactNode;
}) {
  return (
    <WizardChoices label={label}>
      <WizardChoice
        id={`${name}-yes`}
        name={name}
        checked={value === true}
        onPick={() => onPick(true)}
        detail={yesDetail}
      >
        {yesLabel}
      </WizardChoice>
      <WizardChoice
        id={`${name}-no`}
        name={name}
        checked={value === false}
        onPick={() => onPick(false)}
        detail={noDetail}
      >
        {noLabel}
      </WizardChoice>
    </WizardChoices>
  );
}

export type UsualOrOwn = 'usual' | 'own';

/**
 * "Use the usual value" or "set my own". The own value's field (`children`) appears only after the
 * second is picked, so most people never see a text box.
 */
export function WizardUsualOrOwn({
  label,
  name,
  mode,
  onPick,
  usualLabel,
  usualDetail,
  ownLabel = 'Set my own',
  ownDetail,
  children,
}: {
  label: string;
  name: string;
  mode: UsualOrOwn | null;
  onPick: (mode: UsualOrOwn) => void;
  usualLabel: ReactNode;
  usualDetail?: ReactNode;
  ownLabel?: ReactNode;
  ownDetail?: ReactNode;
  /** The field(s) for the own value. */
  children: ReactNode;
}) {
  return (
    <>
      <WizardOptions<UsualOrOwn>
        label={label}
        name={name}
        value={mode}
        onPick={onPick}
        options={[
          { value: 'usual', label: usualLabel, detail: usualDetail },
          { value: 'own', label: ownLabel, detail: ownDetail },
        ]}
      />
      {mode === 'own' ? children : null}
    </>
  );
}

/**
 * The "Change something else?" question that ends a loop, so a person can keep going through
 * several items (tanks, pumps, stations) and stop when done.
 */
export function WizardAnother({
  wizard,
  title = 'Change something else?',
  hint,
  yesLabel = 'Yes, change something else',
  noLabel = 'No, I am done',
  onYes,
  onNo,
}: {
  wizard: Pick<Wizard, 'position' | 'total' | 'captureHeading' | 'back'>;
  title?: string;
  hint?: string;
  yesLabel?: string;
  noLabel?: string;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <WizardStep wizard={wizard} title={title} hint={hint}>
      <div className={styles.actions}>
        <Button type="button" onClick={onYes}>
          {yesLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={onNo}>
          {noLabel}
        </Button>
        <Button type="button" variant="quiet" onClick={wizard.back}>
          Back
        </Button>
      </div>
    </WizardStep>
  );
}

/* Saving progress ------------------------------------------------------------- */

const SAVE_AFTER_MS = 400;

/**
 * Keeps a wizard's answers (all of them, not only the screen showing) on this device so a reload
 * does not lose them. The saved copy is offered back with `WizardResumeNotice`, never applied on
 * its own, and cleared with `clear()` once the wizard saves for real.
 *
 * - `key`: from `wizardDraftKey`; `null` while the person or place is not known yet (nothing is kept).
 * - `version`: changes when the record being edited changes, so a stale draft is dropped.
 * - `steps`: every screen the wizard has, so a draft for a screen that is gone is not restored.
 * - `onRestore`: puts the saved answers back into the wizard's own state.
 * Put `ownDraft` on the `WizardCard` so the page-wide draft keeper stays out of the way.
 */
export function useWizardDraft<S extends string, A extends Record<string, unknown>>({
  key,
  version,
  steps,
  wizard,
  answers,
  onRestore,
}: {
  key: string | null;
  version: string;
  steps: readonly S[];
  wizard: Pick<Wizard<S>, 'step' | 'index' | 'show'>;
  answers: A;
  onRestore: (saved: A) => void;
}) {
  const [offer, setOffer] = useState<WizardDraft<A> | null>(null);
  const checked = useRef<string | null>(null);

  // Look for a saved draft once per key, after the screen has appeared.
  useEffect(() => {
    if (!key || checked.current === key) return;
    checked.current = key;
    const saved = loadWizardDraft<A>(key, version, steps);
    // Browser storage only exists after the first render, so this cannot be the initial state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setOffer(saved.data);
  }, [key, version, steps]);

  // Save as answers or screens change, but not while a saved draft is waiting to be answered.
  useEffect(() => {
    if (!key || offer) return;
    const timer = window.setTimeout(
      () =>
        saveWizardDraft(key, version, {
          step: wizard.step,
          index: wizard.index,
          answers,
        }),
      SAVE_AFTER_MS,
    );
    return () => window.clearTimeout(timer);
  }, [key, version, offer, wizard.step, wizard.index, answers]);

  return {
    offer,
    resume() {
      if (!offer) return;
      onRestore(offer.answers);
      wizard.show(offer.step as S, offer.index);
      setOffer(null);
    },
    discard() {
      if (key) clearWizardDraft(key);
      setOffer(null);
    },
    /** Call once the wizard has saved for real. */
    clear() {
      if (key) clearWizardDraft(key);
      setOffer(null);
    },
  };
}

/** Offers a saved draft back. Shows nothing when there is none. */
export function WizardResumeNotice({
  offer,
  onResume,
  onDiscard,
}: {
  offer: unknown;
  onResume: () => void;
  onDiscard: () => void;
}) {
  if (!offer) return null;
  return (
    <div className={styles.notice} role="status">
      <p className={styles.noticeText}>
        <strong>You were part way through this.</strong> Pick up where you left off?
      </p>
      <div className={styles.actions}>
        <Button type="button" size="sm" onClick={onResume}>
          Continue where I was
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onDiscard}>
          Start again
        </Button>
      </div>
    </div>
  );
}

/* Confirm ---------------------------------------------------------------------- */

export type WizardConfirmDetail = { label: string; value: ReactNode };

/**
 * The one confirm screen. Approve, reject, reverse, suspend and remove stay a single click plus
 * this confirm, never a multi-step wizard. Say what will happen and whether it can be undone.
 * Host it in `Modal presentation="page"`, which supplies the card, so it looks like every other screen.
 */
export function WizardConfirm({
  title,
  consequence,
  details,
  reason,
  confirmLabel,
  cancelLabel = 'Keep it as it is',
  tone = 'default',
  acknowledgement,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  /** Name the action and its object: "Reverse this expense?" */
  title: string;
  /** What will happen, in plain words, including whether it can be undone. */
  consequence: ReactNode;
  details?: readonly WizardConfirmDetail[];
  /** Ask why, when the action needs a reason. The button stays off until it is filled in. */
  reason?: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    required?: boolean;
    maxLength?: number;
  };
  /** Verb and object: "Reverse expense". Never "OK" or "Yes". */
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'default' | 'warning' | 'danger';
  /** For irreversible actions: a tick-box the person must tick before the button turns on. */
  acknowledgement?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const reasonMissing = Boolean(reason?.required) && !reason?.value.trim();
  const ackMissing = Boolean(acknowledgement) && !acknowledged;
  return (
    <div className={styles.page}>
      <h2
        tabIndex={-1}
        className={styles.question}
        ref={(el) => {
          // Risky confirmations start on the safe choice (Cancel); the others start on the question.
          if (tone === 'default') el?.focus();
        }}
      >
        {title}
      </h2>
      <p className={styles.hint}>{consequence}</p>
      {details && details.length > 0 ? (
        <WizardSummary>
          {details.map((detail) => (
            <WizardSummaryRow key={detail.label} label={detail.label}>
              {detail.value}
            </WizardSummaryRow>
          ))}
        </WizardSummary>
      ) : null}
      {reason ? (
        <label className={styles.reason}>
          <span>{reason.label}</span>
          <textarea
            rows={3}
            value={reason.value}
            maxLength={reason.maxLength ?? 500}
            onChange={(event) => reason.onChange(event.target.value)}
          />
        </label>
      ) : null}
      {acknowledgement ? (
        <Checkbox
          label={acknowledgement}
          checked={acknowledged}
          disabled={busy}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button
          type="button"
          variant={tone === 'danger' ? 'danger' : 'primary'}
          onClick={onConfirm}
          loading={busy}
          disabled={reasonMissing || ackMissing}
        >
          {confirmLabel}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={busy}
          data-autofocus={tone === 'default' ? undefined : true}
        >
          {cancelLabel}
        </Button>
      </div>
    </div>
  );
}
