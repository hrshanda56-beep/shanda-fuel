'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Card } from './primitives';
import { popTrail, pushTrail, returnsToSummary, stepPosition } from './wizard-nav';
import styles from './wizard.module.css';

/**
 * One question per screen, shared by every guided flow.
 *
 * `useWizard` owns where the person is (a step, plus an optional index for a step that repeats,
 * such as "item 2"), the way back, field errors and moving focus. The screen decides what each
 * step asks and how it is checked. `useWizard` saves nothing; a wizard that should survive a
 * reload adds `useWizardDraft` below. The pure rules live in `wizard-nav.ts` and `wizard-draft.ts`.
 */

export type WizardErrors = Record<string, string>;

export function useWizard<S extends string>({
  start,
  sequence,
  onCancel,
}: {
  start: S;
  /** The steps in order, as they apply right now. Used for "Step 2 of 7". */
  sequence: readonly S[];
  /** Called when Back is pressed on the first screen. */
  onCancel: () => void;
}) {
  const [step, setStep] = useState<S>(start);
  const [index, setIndex] = useState(0);
  const [trail, setTrail] = useState<{ step: S; index: number }[]>([]);
  const [fromReview, setFromReview] = useState(false);
  const [errors, setErrors] = useState<WizardErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const focusRef = useRef<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  // A callback ref held in state, so the question can be focused when the step changes.
  const [headingEl, captureHeading] = useState<HTMLHeadingElement | null>(null);
  const firstRender = useRef(true);

  /** Moves the cursor to a field once the next render has drawn it. */
  const setFocusId = (id: string) => {
    focusRef.current = id;
    setFocusTick((tick) => tick + 1);
  };

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingEl?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step, index, headingEl]);

  useEffect(() => {
    const focusId = focusRef.current;
    if (!focusId) return;
    focusRef.current = null;
    const element = document.getElementById(focusId);
    element?.focus();
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusTick, step]);

  /** Goes to a screen and remembers the one being left, so Back returns to it. */
  function go(to: S, toIndex = index) {
    setTrail((current) => pushTrail(current, { step, index }));
    setStep(to);
    setIndex(toIndex);
    setErrors({});
    setProblem(null);
  }

  /** Jumps without adding to the trail, for example to the screen holding a mistake. */
  function show(to: S, toIndex = 0) {
    setStep(to);
    setIndex(toIndex);
  }

  function back() {
    setErrors({});
    setProblem(null);
    const { previous, rest } = popTrail(trail);
    if (!previous) return onCancel();
    setStep(previous.step);
    setIndex(previous.index);
    setTrail(rest);
    if (returnsToSummary(sequence, previous)) setFromReview(false);
  }

  /** From the summary: change one answer, then come straight back to the summary. */
  function change(to: S, toIndex = index) {
    setFromReview(true);
    go(to, toIndex);
  }

  /**
   * Finishes a question. With mistakes it shows them and puts the cursor on the first one.
   * Otherwise it moves on, or back to the summary when the person came from there
   * (`returnTo`; leave it out for a step that must always continue forward).
   */
  function advance(found: WizardErrors, to: S, returnTo?: S) {
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      setFocusId(first);
      return false;
    }
    if (fromReview && returnTo) {
      setFromReview(false);
      go(returnTo);
      return true;
    }
    go(to);
    return true;
  }

  const position = stepPosition(sequence, step);

  return {
    step,
    index,
    trail,
    errors,
    setErrors,
    problem,
    setProblem,
    setFocusId,
    captureHeading,
    position,
    total: sequence.length,
    atStart: trail.length === 0,
    go,
    show,
    back,
    change,
    advance,
  };
}

export type Wizard<S extends string = string> = ReturnType<typeof useWizard<S>>;

/** The line under every "Check ..." screen, so they all read the same. */
export const WIZARD_REVIEW_HINT = 'Nothing is saved until you confirm.';

/**
 * The white card every step sits in. Set `ownDraft` when the wizard saves its own progress with
 * `useWizardDraft`, so the page-wide draft keeper does not also read the one screen showing.
 */
export function WizardCard({
  children,
  ownDraft = false,
  wide = false,
}: {
  children: ReactNode;
  ownDraft?: boolean;
  /** Fill the page width. For check screens that list many answers rather than ask one question. */
  wide?: boolean;
}) {
  return (
    <Card
      className={wide ? `${styles.wizard} ${styles.wizardWide}` : styles.wizard}
      {...(ownDraft ? { 'data-no-page-draft': '' } : {})}
    >
      {children}
    </Card>
  );
}

/** Buttons that only move forward. A screen whose button saves something never moves on by itself. */
const FORWARD_LABEL = /^(continue|next|check|review)\b/i;

/**
 * When a screen asks one single-choice question (one dropdown, or one set of big answers) and the
 * person picks with the mouse or a finger, carry on straight away: nothing else is left to fill in.
 * Keyboard changes are left alone so arrowing through a list does not skip past the answer.
 * It presses the real Continue button, so the usual checks still run.
 */
function autoContinue(target: HTMLElement, root: HTMLElement | null, lastKey: number) {
  const isSelect = target instanceof HTMLSelectElement;
  const isRadio = target instanceof HTMLInputElement && target.type === 'radio';
  if (!isSelect && !isRadio) return;
  if (isSelect && !target.value) return;
  if (Date.now() - lastKey < 600) return;
  window.setTimeout(() => {
    if (!root || !root.isConnected) return;
    const controls = Array.from(
      root.querySelectorAll<HTMLElement>(
        'input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
      ),
    );
    const alone = isSelect
      ? controls.length === 1
      : controls.every(
          (c) => c instanceof HTMLInputElement && c.type === 'radio' && c.name === target.name,
        );
    if (!alone) return;
    const button = root.querySelector<HTMLButtonElement>(`.${styles.actions} button`);
    if (!button || button.disabled || !FORWARD_LABEL.test(button.textContent?.trim() ?? '')) return;
    button.click();
  }, 120);
}

/** One screen: "Step 2 of 7", the question, an optional hint, then the answers. */
export function WizardStep({
  wizard,
  title,
  hint,
  calm = true,
  children,
}: {
  wizard: Pick<Wizard, 'position' | 'total' | 'captureHeading'>;
  title: string;
  hint?: string;
  /** A thin progress bar and a small, faint, italic hint (the default); false gives "Step 2 of 7". */
  calm?: boolean;
  children: ReactNode;
}) {
  const page = useRef<HTMLDivElement>(null);
  const lastKey = useRef(0);
  // Start in the first box, so people can type straight away.
  useEffect(() => {
    const root = page.current;
    if (!root || root.contains(document.activeElement)) return;
    const timer = window.setTimeout(() => {
      root
        .querySelector<HTMLElement>(
          'input:not([type=radio]):not([type=checkbox]):not([type=hidden]):not([type=file]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
        )
        ?.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [title]);
  return (
    // Enter in a box does what the Continue button does. A screen opts out with `data-no-enter`.
    <div
      ref={page}
      className={styles.page}
      onChange={(event) => autoContinue(event.target as HTMLElement, page.current, lastKey.current)}
      onKeyDown={(event) => {
        if (event.key !== 'Tab' && event.key !== 'Enter' && event.key !== 'Shift') {
          lastKey.current = Date.now();
        }
        const target = event.target as HTMLElement;
        if (event.key !== 'Enter' || event.defaultPrevented || event.nativeEvent.isComposing)
          return;
        if (target.tagName !== 'INPUT' || target.closest('[data-no-enter], [role=combobox]'))
          return;
        const type = (target as HTMLInputElement).type;
        if (type === 'checkbox' || type === 'radio' || type === 'button' || type === 'submit')
          return;
        const button = page.current?.querySelector<HTMLButtonElement>(`.${styles.actions} button`);
        if (!button || button.disabled) return;
        event.preventDefault();
        button.click();
      }}
    >
      <WizardHeading
        position={wizard.position}
        total={wizard.total}
        onHeading={wizard.captureHeading}
        title={title}
        hint={hint}
        calm={calm}
      />
      {children}
    </div>
  );
}

/** "Step 2 of 7", the question and an optional hint, for screens that lay out their own body. */
export function WizardHeading({
  position,
  total,
  onHeading,
  title,
  hint,
  calm = true,
}: {
  position: number;
  total: number;
  onHeading: (element: HTMLHeadingElement | null) => void;
  title: string;
  hint?: string;
  calm?: boolean;
}) {
  return (
    <>
      {/* A lone first question (before the flow's steps are known) passes `total` 0 to hide this. */}
      {total > 0 ? (
        calm ? (
          <div
            className={styles.progress}
            role="progressbar"
            aria-label="Progress"
            aria-valuemin={1}
            aria-valuemax={total}
            aria-valuenow={position}
          >
            <span style={{ width: `${Math.round((position / total) * 100)}%` }} />
          </div>
        ) : (
          <p className={styles.stepCount}>
            Step {position} of {total}
          </p>
        )
      ) : null}
      <h2 ref={onHeading} tabIndex={-1} className={styles.question}>
        {title}
      </h2>
      {hint ? <p className={calm ? styles.hintCalm : styles.hint}>{hint}</p> : null}
    </>
  );
}

/** The two buttons under every question. */
export function WizardActions({
  wizard,
  onContinue,
  continueLabel = 'Continue',
  busy = false,
  extra,
}: {
  wizard: Pick<Wizard, 'atStart' | 'back'>;
  onContinue: () => void;
  continueLabel?: string;
  busy?: boolean;
  /** An extra button after Back, for example "Skip for now". */
  extra?: ReactNode;
}) {
  return (
    <div className={styles.actions}>
      <Button type="button" onClick={onContinue} loading={busy}>
        {continueLabel}
      </Button>
      <Button type="button" variant="secondary" onClick={wizard.back} disabled={busy}>
        {wizard.atStart ? 'Cancel' : 'Back'}
      </Button>
      {extra}
    </div>
  );
}

export function WizardChoices({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.choices} role="radiogroup" aria-label={label}>
      {children}
    </div>
  );
}

/** One big, easy-to-tap answer. */
export function WizardChoice({
  id,
  name,
  checked,
  onPick,
  children,
  detail,
}: {
  id?: string;
  name?: string;
  checked: boolean;
  onPick: () => void;
  children: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <label className={styles.choice} htmlFor={id}>
      <input id={id} name={name} type="radio" checked={checked} onChange={onPick} />
      <span className={styles.choiceText}>
        <span>{children}</span>
        {detail ? <span className={styles.choiceDetail}>{detail}</span> : null}
      </span>
    </label>
  );
}

/** The "check your answers" list. Each row has a Change button. */
export function WizardSummary({ children }: { children: ReactNode }) {
  return <div className={styles.summary}>{children}</div>;
}

export function WizardSummaryRow({
  label,
  onChange,
  changeLabel = 'Change',
  children,
}: {
  label: string;
  onChange?: () => void;
  changeLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.summaryRow}>
      <span>
        <small className={styles.summaryLabel}>{label}</small>
        {children}
      </span>
      {onChange ? (
        <Button type="button" variant="quiet" size="sm" onClick={onChange}>
          {changeLabel}
        </Button>
      ) : null}
    </div>
  );
}

/** A small, faint, italic line for something the person may like to know, never to act on. */
export function WizardQuiet({ children }: { children: ReactNode }) {
  return <p className={styles.quiet}>{children}</p>;
}

export function WizardNotice({ children }: { children: ReactNode }) {
  return <p className={styles.notice}>{children}</p>;
}

/** Two short fields side by side, one under the other on a phone. */
export function WizardPair({ children }: { children: ReactNode }) {
  return <div className={styles.grid2}>{children}</div>;
}
