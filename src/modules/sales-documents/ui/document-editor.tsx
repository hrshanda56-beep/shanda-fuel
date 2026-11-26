'use client';

import { useMemo, useState } from 'react';
import { Button, ErrorState, Field, NumericInput } from '@/design-system/primitives';
import {
  WizardActions,
  WizardCard,
  WizardChoice,
  WizardChoices,
  WizardHeading,
  useWizard,
} from '@/design-system/wizard';
import { OTHER_VALUE, Select, SelectWithOther } from '@/design-system/forms';
import { todayInBusinessTime } from '@/modules/expenses/ui/expense-format';
import { MAX_DOCUMENT_LINES } from '../contracts';
import { computeDocumentTotals, lineGross } from '../domain';
import { DOC_LABELS, addDays, formatAmount, friendlyDate } from '../format';
import {
  UNIT_OPTIONS,
  buildFuelChoices,
  fuelUnit,
  isListedUnit,
  matchFuelChoice,
  trimZeros,
} from '../item-choices';
import type {
  SalesDocumentDetail,
  SalesDocumentFuelOption,
  SalesDocumentProfileView,
} from '../queries';
import { PrintPreview } from './print-preview';
import styles from './sales-documents.module.css';
import { useSalesCommand } from './use-sales-command';
import { formatMoney } from '@/design-system/formatters';

type Line = {
  key: number;
  productId: string | null;
  description: string;
  quantity: string;
  unitLabel: string;
  unitPrice: string;
  discountAmount: string;
  taxRate: string;
};

type Step =
  'who' | 'details' | 'item' | 'more' | 'tax' | 'discount' | 'dates' | 'extras' | 'review';

let nextKey = 1;
const blankLine = (taxRate: string): Line => ({
  key: nextKey++,
  productId: null,
  description: '',
  quantity: '1',
  unitLabel: '',
  unitPrice: '',
  discountAmount: '0',
  taxRate,
});

const amountOk = (value: string) => /^\d+(\.\d+)?$/.test(value.trim());

const lineAmount = (line: Line): string => {
  try {
    if (!amountOk(line.quantity) || !amountOk(line.unitPrice)) return '';
    return formatAmount(lineGross(line.quantity, line.unitPrice));
  } catch {
    return '';
  }
};

export function DocumentEditor({
  tenantId,
  legalEntityId,
  docType,
  existing,
  profile,
  customers,
  fuels,
  stationId,
  onSaved,
  onCancel,
}: {
  tenantId: string;
  legalEntityId: string;
  docType: 'QUOTATION' | 'INVOICE';
  existing: SalesDocumentDetail | null;
  profile: SalesDocumentProfileView;
  customers: { customerId: string; name: string }[];
  fuels: SalesDocumentFuelOption[];
  stationId: string | null;
  onSaved: (documentId: string) => void;
  onCancel: () => void;
}) {
  const command = useSalesCommand(tenantId);
  const today = todayInBusinessTime();
  const label = DOC_LABELS[docType].one.toLowerCase();

  const [customerId, setCustomerId] = useState(existing?.customerId ?? '');
  const [name, setName] = useState(existing?.recipientName ?? '');
  const [address, setAddress] = useState(existing?.recipientAddress ?? '');
  const [taxNumber, setTaxNumber] = useState(existing?.recipientTaxNumber ?? '');
  const [email, setEmail] = useState(existing?.recipientEmail ?? '');
  const [issueDate, setIssueDate] = useState(existing?.issueDate ?? today);
  const [validUntil, setValidUntil] = useState(
    existing?.validUntil ?? addDays(today, profile.defaultValidDays),
  );
  const [dueDate, setDueDate] = useState(
    existing?.dueDate ?? addDays(today, profile.defaultDueDays),
  );
  const [taxLabel, setTaxLabel] = useState(existing?.taxLabel ?? profile.taxLabel);
  const [renamingTax, setRenamingTax] = useState(false);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [terms, setTerms] = useState(existing?.terms ?? profile.defaultTerms ?? '');
  const [lines, setLines] = useState<Line[]>(
    existing && existing.lines.length > 0
      ? existing.lines.map((line) => ({
          key: nextKey++,
          productId: line.productId,
          description: line.description,
          quantity: trimZeros(line.quantity),
          unitLabel: line.unitLabel ?? '',
          unitPrice: trimZeros(line.unitPrice),
          discountAmount: trimZeros(line.discountAmount),
          taxRate: trimZeros(line.taxRate),
        }))
      : [blankLine(trimZeros(profile.defaultTaxRate))],
  );
  const currency = existing?.currency ?? 'USD';

  // Tax and discount are asked as yes/no questions. An existing document whose
  // items carry different tax rates keeps them exactly as saved.
  const mixedTax = useMemo(
    () => new Set(lines.map((line) => Number(line.taxRate || 0))).size > 1,
    // Only the document as first opened decides this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [taxOn, setTaxOn] = useState(
    existing
      ? lines.some((line) => Number(line.taxRate || 0) > 0)
      : Number(profile.defaultTaxRate || 0) > 0,
  );
  const [taxRate, setTaxRate] = useState(
    trimZeros(
      lines.find((line) => Number(line.taxRate || 0) > 0)?.taxRate ?? profile.defaultTaxRate,
    ) || '0',
  );
  const [discountOn, setDiscountOn] = useState(
    lines.some((line) => Number(line.discountAmount || 0) > 0),
  );

  // Where the person is. New documents start at the first question; an
  // existing one opens on the summary so they can change just what they need.
  const startStep: Step = existing ? 'review' : customers.length > 0 ? 'who' : 'details';
  const sequence: Step[] = [
    ...(customers.length > 0 ? (['who'] as Step[]) : []),
    'details',
    'item',
    'more',
    'tax',
    'discount',
    'dates',
    'extras',
    'review',
  ];
  const wizard = useWizard<Step>({ start: startStep, sequence, onCancel });
  const { step, index: itemIndex, errors, problem, setErrors, setProblem, setFocusId } = wizard;

  const effLines = useMemo(
    () =>
      lines.map((line) => ({
        ...line,
        discountAmount: discountOn ? line.discountAmount || '0' : '0',
        taxRate: mixedTax ? line.taxRate || '0' : taxOn ? taxRate || '0' : '0',
      })),
    [lines, discountOn, taxOn, taxRate, mixedTax],
  );

  const fuelChoices = useMemo(() => buildFuelChoices(fuels, stationId), [fuels, stationId]);

  const totals = useMemo(() => {
    try {
      const ready = effLines.filter((line) => line.quantity && line.unitPrice);
      return computeDocumentTotals(
        ready.map((line) => ({
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount,
          taxRate: line.taxRate,
        })),
      );
    } catch {
      return null;
    }
  }, [effLines]);

  function patch(key: number, change: Partial<Line>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...change } : line)),
    );
  }

  /** Items whose unit is typed in rather than picked from the list. */
  const [unitTyped, setUnitTyped] = useState<Record<number, boolean>>({});

  /** Which option each item uses: a fuel's value, or OTHER_VALUE for something typed. */
  const [itemChoices, setItemChoices] = useState<Record<number, string>>({});
  const currentItem = lines[itemIndex];
  const itemChoice = !currentItem
    ? ''
    : (itemChoices[currentItem.key] ??
      (currentItem.productId
        ? matchFuelChoice(fuelChoices, currentItem)
        : currentItem.description
          ? OTHER_VALUE
          : ''));

  function chooseItem(value: string) {
    const line = lines[itemIndex];
    if (!line) return;
    setItemChoices((current) => ({ ...current, [line.key]: value }));
    if (value === OTHER_VALUE) {
      patch(line.key, { productId: null, description: '', unitLabel: '', unitPrice: '' });
      setUnitTyped((current) => ({ ...current, [line.key]: false }));
      setFocusId(`sd-desc-${line.key}-other`);
    } else {
      applyFuel(value);
    }
  }

  function applyFuel(value: string) {
    const choice = fuelChoices.find((option) => option.value === value);
    const line = lines[itemIndex];
    if (!choice || !line) return;
    patch(line.key, {
      productId: choice.fuel.productId,
      description: `${choice.fuel.name}${choice.suffix}`,
      unitLabel: fuelUnit(choice.fuel),
      unitPrice: trimZeros(choice.price),
      quantity: '',
    });
    setUnitTyped((current) => ({ ...current, [line.key]: false }));
    // A plain fuel has no price yet, so the price is the next thing to fill in.
    if (choice.price === '') setFocusId(`sd-price-${line.key}`);
  }

  const unitChoiceFor = (line: Line): string =>
    (unitTyped[line.key] ?? !isListedUnit(line.unitLabel)) ? OTHER_VALUE : line.unitLabel;

  function chooseUnit(line: Line, value: string) {
    const typed = value === OTHER_VALUE;
    setUnitTyped((current) => ({ ...current, [line.key]: typed }));
    patch(line.key, { unitLabel: typed ? '' : value });
    if (typed) setFocusId(`sd-unit-${line.key}-other`);
  }

  function pickCustomer(id: string) {
    setCustomerId(id);
    const chosen = customers.find((customer) => customer.customerId === id);
    if (chosen) setName(chosen.name);
  }

  const { go: navigate, change } = wizard;

  /** Check one question; returns the first field that needs attention. */
  function check(which: Step): Record<string, string> {
    const found: Record<string, string> = {};
    if (which === 'who' && customerId === '' && !name.trim()) {
      found['sd-who-other'] = 'Type their name.';
    }
    if (which === 'details' && !name.trim()) {
      found['sd-name'] = `Who is this ${label} for? Add a name.`;
    }
    const checkItem = (line: Line) => {
      if (!line.description.trim()) found[`sd-desc-${line.key}`] = 'Describe this item.';
      if (!amountOk(line.quantity) || Number(line.quantity) <= 0) {
        found[`sd-qty-${line.key}`] = 'Enter a quantity above zero.';
      }
      if (!amountOk(line.unitPrice)) found[`sd-price-${line.key}`] = 'Enter the price each.';
    };
    if (which === 'item') {
      const line = lines[itemIndex];
      if (line) checkItem(line);
    }
    if (which === 'tax' && taxOn && !mixedTax) {
      if (!amountOk(taxRate) || Number(taxRate) > 100) {
        found['sd-rate'] = 'Enter a percentage from 0 to 100.';
      }
    }
    if (which === 'discount' && discountOn) {
      for (const line of lines) {
        if (line.discountAmount && !amountOk(line.discountAmount)) {
          found[`sd-disc-${line.key}`] = 'Enter the discount as an amount, or 0.';
          continue;
        }
        try {
          computeDocumentTotals([
            {
              quantity: line.quantity || '0',
              unitPrice: line.unitPrice || '0',
              discountAmount: line.discountAmount || '0',
              taxRate: '0',
            },
          ]);
        } catch {
          found[`sd-disc-${line.key}`] = 'The discount cannot be more than this item costs.';
        }
      }
    }
    return found;
  }

  function next(from: Step) {
    const order: Record<Step, Step> = {
      who: 'details',
      details: 'item',
      item: 'more',
      more: 'tax',
      tax: 'discount',
      discount: 'dates',
      dates: 'extras',
      extras: 'review',
      review: 'review',
    };
    wizard.advance(check(from), order[from], from === 'item' ? undefined : 'review');
  }

  function addItem() {
    if (lines.length >= MAX_DOCUMENT_LINES) return;
    const line = blankLine(trimZeros(profile.defaultTaxRate));
    setLines((current) => [...current, line]);
    navigate('item', lines.length);
  }

  function removeItem(key: number) {
    setLines((current) => (current.length > 1 ? current.filter((l) => l.key !== key) : current));
  }

  /** Checks every answer and, if all are fine, returns what is saved (and previewed). */
  function draftBody(): Record<string, unknown> | null {
    setProblem(null);
    const order: Step[] = ['details', 'item', 'tax', 'discount'];
    for (const which of order) {
      if (which === 'item') {
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i]!;
          const found: Record<string, string> = {};
          if (!line.description.trim()) found[`sd-desc-${line.key}`] = 'Describe this item.';
          if (!amountOk(line.quantity) || Number(line.quantity) <= 0) {
            found[`sd-qty-${line.key}`] = 'Enter a quantity above zero.';
          }
          if (!amountOk(line.unitPrice)) found[`sd-price-${line.key}`] = 'Enter the price each.';
          if (Object.keys(found).length > 0) {
            wizard.show('item', i);
            setErrors(found);
            setProblem(`Item ${i + 1} needs attention before this can be saved.`);
            setFocusId(Object.keys(found)[0]!);
            return null;
          }
        }
        continue;
      }
      const found = check(which);
      if (Object.keys(found).length > 0) {
        wizard.show(which, itemIndex);
        setErrors(found);
        setProblem('Something needs attention before this can be saved.');
        setFocusId(Object.keys(found)[0]!);
        return null;
      }
    }
    if (!totals) {
      setProblem('Check the numbers on your items. One of them is not valid.');
      return null;
    }
    return {
      commandType: 'SaveSalesDocumentDraft',
      tenantId,
      legalEntityId,
      ...(existing ? { documentId: existing.id, expectedVersion: existing.version } : {}),
      docType,
      customerId: customerId || null,
      recipientName: name,
      recipientAddress: address,
      recipientTaxNumber: taxNumber,
      recipientEmail: email,
      issueDate,
      validUntil: docType === 'QUOTATION' ? validUntil || null : null,
      dueDate: docType === 'INVOICE' ? dueDate || null : null,
      taxLabel,
      notes,
      terms,
      lines: effLines.map((line) => ({
        productId: line.productId,
        description: line.description,
        quantity: line.quantity,
        unitLabel: line.unitLabel,
        unitPrice: line.unitPrice,
        discountAmount: line.discountAmount,
        taxRate: line.taxRate,
      })),
    };
  }

  function save() {
    const body = draftBody();
    if (body) void command.send(body, (result) => onSaved(String(result.documentId)));
  }

  const heading = (text: string, hint?: string) => (
    <WizardHeading
      position={wizard.position}
      total={wizard.total}
      onHeading={wizard.captureHeading}
      title={text}
      hint={hint}
    />
  );

  const nav = (continueLabel = 'Continue') => (
    <WizardActions
      wizard={wizard}
      onContinue={() => (step === 'review' ? save() : next(step))}
      continueLabel={continueLabel}
      busy={command.busy}
    />
  );

  const choice = (id: string, text: string, checked: boolean, onPick: () => void) => (
    <WizardChoice id={id} checked={checked} onPick={onPick}>
      {text}
    </WizardChoice>
  );

  const item = lines[itemIndex];

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (step === 'review') save();
        else next(step);
      }}
      className={styles.page}
      noValidate
    >
      <WizardCard>
        {step === 'who' ? (
          <div className={styles.page}>
            {heading(
              `Who is this ${label} for?`,
              'Pick someone you already have, or add new details.',
            )}
            <div className={styles.choices} role="radiogroup" aria-label="Customer">
              {customers.map((c) => (
                <label key={c.customerId} className={styles.choice}>
                  <input
                    type="radio"
                    name="sd-customer"
                    checked={customerId === c.customerId}
                    onChange={() => pickCustomer(c.customerId)}
                  />
                  <span>{c.name}</span>
                </label>
              ))}
              <label className={styles.choice}>
                <input
                  type="radio"
                  name="sd-customer"
                  checked={customerId === ''}
                  onChange={() => {
                    setCustomerId('');
                    setName('');
                    setFocusId('sd-who-other');
                  }}
                />
                <span>Other (someone not on this list)</span>
              </label>
            </div>
            {customerId === '' ? (
              <Field id="sd-who-other" label="Their name" required error={errors['sd-who-other']}>
                <input
                  id="sd-who-other"
                  value={name}
                  maxLength={200}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
            ) : null}
            {nav()}
          </div>
        ) : null}

        {step === 'details' ? (
          <div className={styles.page}>
            {heading(customerId ? 'Check their details' : 'What are their details?')}
            <Field id="sd-name" label="Name" required error={errors['sd-name']}>
              <input
                id="sd-name"
                value={name}
                maxLength={200}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field id="sd-email" label="Email" optional hint="Needed only to email it from here.">
              <input
                id="sd-email"
                type="email"
                value={email}
                maxLength={200}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field id="sd-address" label="Address" optional>
              <textarea
                id="sd-address"
                rows={2}
                value={address}
                maxLength={500}
                onChange={(e) => setAddress(e.target.value)}
              />
            </Field>
            <Field id="sd-tax" label={`Their ${taxLabel || 'tax'} number`} optional>
              <input
                id="sd-tax"
                value={taxNumber}
                maxLength={60}
                onChange={(e) => setTaxNumber(e.target.value)}
              />
            </Field>
            {nav()}
          </div>
        ) : null}

        {step === 'item' && item ? (
          <div className={styles.page}>
            {heading(
              lines.length > 1
                ? `Item ${itemIndex + 1}: what are you charging for?`
                : 'What are you charging for?',
            )}
            {fuelChoices.length > 0 ? (
              <Field
                id={`sd-desc-${item.key}`}
                label="What is it?"
                required
                error={itemChoice === OTHER_VALUE ? undefined : errors[`sd-desc-${item.key}`]}
              >
                <SelectWithOther
                  id={`sd-desc-${item.key}`}
                  placeholder="Choose a fuel, or Other"
                  otherLabel="Other (something else, like a delivery fee)"
                  detailLabel="What are you charging for?"
                  detailPlaceholder="For example: Delivery fee"
                  detailMaxLength={300}
                  detailError={errors[`sd-desc-${item.key}`]}
                  options={fuelChoices.map((c) => ({ value: c.value, label: c.label }))}
                  choice={itemChoice}
                  onChoice={(value) => chooseItem(value)}
                  detail={item.description}
                  onDetail={(value) => patch(item.key, { description: value })}
                />
              </Field>
            ) : (
              <Field
                id={`sd-desc-${item.key}`}
                label="Description"
                required
                error={errors[`sd-desc-${item.key}`]}
              >
                <input
                  id={`sd-desc-${item.key}`}
                  value={item.description}
                  maxLength={300}
                  placeholder="For example: Diesel, or Delivery fee"
                  onChange={(e) => patch(item.key, { description: e.target.value })}
                />
              </Field>
            )}
            <div className={styles.grid2}>
              <NumericInput
                id={`sd-qty-${item.key}`}
                label="Quantity"
                required
                error={errors[`sd-qty-${item.key}`]}
                value={item.quantity}
                onChange={(e) => patch(item.key, { quantity: e.target.value })}
              />
              <Field id={`sd-unit-${item.key}`} label="Unit" optional>
                <SelectWithOther
                  id={`sd-unit-${item.key}`}
                  options={UNIT_OPTIONS}
                  otherLabel="Other (type it)"
                  detailLabel="Which unit?"
                  detailPlaceholder="For example: load"
                  detailMaxLength={20}
                  choice={unitChoiceFor(item)}
                  onChoice={(value) => chooseUnit(item, value)}
                  detail={item.unitLabel}
                  onDetail={(value) => patch(item.key, { unitLabel: value })}
                />
              </Field>
            </div>
            <NumericInput
              id={`sd-price-${item.key}`}
              label={`Price each (${currency})`}
              required
              error={errors[`sd-price-${item.key}`]}
              value={item.unitPrice}
              onChange={(e) => patch(item.key, { unitPrice: e.target.value })}
            />
            {lineAmount(item) ? (
              <p className={styles.muted} aria-live="polite">
                This item: {formatMoney(lineAmount(item), currency)}
              </p>
            ) : null}
            {nav()}
          </div>
        ) : null}

        {step === 'more' ? (
          <div className={styles.page}>
            {heading('Your items', 'Is there anything else to add?')}
            <div className={styles.summary}>
              {lines.map((line, index) => (
                <div key={line.key} className={styles.summaryRow}>
                  <span>
                    <strong>{line.description || `Item ${index + 1}`}</strong>
                    <small className={styles.muted}>
                      {' '}
                      {line.quantity} {line.unitLabel} x {line.unitPrice || '?'}
                      {lineAmount(line) ? ` = ${formatMoney(lineAmount(line), currency)}` : ''}
                    </small>
                  </span>
                  <span className={styles.actions}>
                    <Button
                      type="button"
                      variant="quiet"
                      size="sm"
                      onClick={() => navigate('item', index)}
                    >
                      Change
                    </Button>
                    {lines.length > 1 ? (
                      <Button
                        type="button"
                        variant="quiet"
                        size="sm"
                        onClick={() => removeItem(line.key)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
            <div>
              <Button
                type="button"
                variant="secondary"
                disabled={lines.length >= MAX_DOCUMENT_LINES}
                onClick={addItem}
              >
                Add another item
              </Button>
            </div>
            {nav()}
          </div>
        ) : null}

        {step === 'tax' ? (
          <div className={styles.page}>
            {heading(`Should ${taxLabel || 'tax'} be added?`)}
            {mixedTax ? (
              <p className={styles.notice}>
                The items on this {label} have different rates. They are kept as they were saved.
              </p>
            ) : (
              <>
                <div className={styles.choices} role="radiogroup" aria-label="Add tax">
                  {choice('sd-tax-yes', `Yes, add ${taxLabel || 'tax'}`, taxOn, () =>
                    setTaxOn(true),
                  )}
                  {choice('sd-tax-no', `No ${taxLabel || 'tax'}`, !taxOn, () => setTaxOn(false))}
                </div>
                {taxOn ? (
                  <>
                    <NumericInput
                      id="sd-rate"
                      label={`${taxLabel || 'Tax'} percentage`}
                      error={errors['sd-rate']}
                      value={taxRate}
                      onChange={(e) => setTaxRate(e.target.value)}
                    />
                    {renamingTax ? (
                      <Field
                        id="sd-taxlabel"
                        label="What should the tax be called?"
                        hint="This is the word shown on the document, for example VAT."
                      >
                        <input
                          id="sd-taxlabel"
                          value={taxLabel}
                          maxLength={30}
                          onChange={(e) => setTaxLabel(e.target.value)}
                        />
                      </Field>
                    ) : (
                      <p>
                        It will show on the document as “{taxLabel || 'Tax'}”.{' '}
                        <button
                          type="button"
                          className={styles.linkButton}
                          onClick={() => {
                            setRenamingTax(true);
                            setFocusId('sd-taxlabel');
                          }}
                        >
                          Change the name
                        </button>
                      </p>
                    )}
                  </>
                ) : null}
              </>
            )}
            {nav()}
          </div>
        ) : null}

        {step === 'discount' ? (
          <div className={styles.page}>
            {heading('Is there a discount?')}
            <div className={styles.choices} role="radiogroup" aria-label="Discount">
              {choice('sd-disc-yes', 'Yes, give a discount', discountOn, () => setDiscountOn(true))}
              {choice('sd-disc-no', 'No discount', !discountOn, () => setDiscountOn(false))}
            </div>
            {discountOn
              ? lines.map((line, index) => (
                  <NumericInput
                    key={line.key}
                    id={`sd-disc-${line.key}`}
                    label={`Discount on ${line.description || `item ${index + 1}`} (${currency}, not %)`}
                    error={errors[`sd-disc-${line.key}`]}
                    value={line.discountAmount}
                    onChange={(e) => patch(line.key, { discountAmount: e.target.value })}
                  />
                ))
              : null}
            {nav()}
          </div>
        ) : null}

        {step === 'dates' ? (
          <div className={styles.page}>
            {heading(
              'Which dates should it show?',
              docType === 'QUOTATION'
                ? 'We have filled in sensible dates. Change them if you need to.'
                : 'We have filled in sensible dates. Change them if you need to.',
            )}
            <Field id="sd-date" label="Date" required>
              <input
                id="sd-date"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </Field>
            {docType === 'QUOTATION' ? (
              <Field id="sd-valid" label="Valid until" optional>
                <input
                  id="sd-valid"
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </Field>
            ) : (
              <Field id="sd-due" label="Payment due" optional>
                <input
                  id="sd-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </Field>
            )}
            {nav()}
          </div>
        ) : null}

        {step === 'extras' ? (
          <div className={styles.page}>
            {heading('Anything to tell the customer?', 'Both are optional. You can skip this.')}
            <Field id="sd-notes" label="Note to the customer" optional>
              <textarea
                id="sd-notes"
                rows={3}
                value={notes}
                maxLength={2000}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
            <Field id="sd-terms" label="Terms" optional>
              <textarea
                id="sd-terms"
                rows={4}
                value={terms}
                maxLength={2000}
                onChange={(e) => setTerms(e.target.value)}
              />
            </Field>
            {nav()}
          </div>
        ) : null}

        {step === 'review' ? (
          <div className={styles.page}>
            {heading(`Check your ${label}`, 'Nothing is saved until you confirm.')}
            <div className={styles.summary}>
              <div className={styles.summaryRow}>
                <span>
                  <small className={styles.muted}>For</small>
                  <strong>{name || 'No name yet'}</strong>
                  {email ? <small className={styles.muted}> · {email}</small> : null}
                </span>
                <Button type="button" variant="quiet" size="sm" onClick={() => change('details')}>
                  Change
                </Button>
              </div>
              <div className={styles.summaryRow}>
                <span>
                  <small className={styles.muted}>Items</small>
                  {lines.map((line, index) => (
                    <span key={line.key} className={styles.summaryLine}>
                      {line.description || `Item ${index + 1}`}
                      <span>
                        {lineAmount(line) ? `${formatMoney(lineAmount(line), currency)}` : '-'}
                      </span>
                    </span>
                  ))}
                </span>
                <Button type="button" variant="quiet" size="sm" onClick={() => change('more')}>
                  Change
                </Button>
              </div>
              <div className={styles.summaryRow}>
                <span>
                  <small className={styles.muted}>{taxLabel || 'Tax'}</small>
                  {mixedTax ? 'Different rates per item' : taxOn ? `${taxRate}%` : 'None'}
                </span>
                <Button type="button" variant="quiet" size="sm" onClick={() => change('tax')}>
                  Change
                </Button>
              </div>
              <div className={styles.summaryRow}>
                <span>
                  <small className={styles.muted}>Discount</small>
                  {discountOn ? 'Yes' : 'None'}
                </span>
                <Button type="button" variant="quiet" size="sm" onClick={() => change('discount')}>
                  Change
                </Button>
              </div>
              <div className={styles.summaryRow}>
                <span>
                  <small className={styles.muted}>
                    {docType === 'QUOTATION' ? 'Dated, valid until' : 'Dated, payment due'}
                  </small>
                  {friendlyDate(issueDate)}
                  {docType === 'QUOTATION'
                    ? validUntil
                      ? `, ${friendlyDate(validUntil)}`
                      : ''
                    : dueDate
                      ? `, ${friendlyDate(dueDate)}`
                      : ''}
                </span>
                <Button type="button" variant="quiet" size="sm" onClick={() => change('dates')}>
                  Change
                </Button>
              </div>
              <div className={styles.summaryRow}>
                <span>
                  <small className={styles.muted}>Note and terms</small>
                  {notes || terms ? 'Added' : 'None'}
                </span>
                <Button type="button" variant="quiet" size="sm" onClick={() => change('extras')}>
                  Change
                </Button>
              </div>
            </div>

            <div className={styles.totals} aria-live="polite">
              {totals ? (
                <>
                  <div className={styles.totalRow}>
                    <span>Subtotal</span>
                    <span>{formatAmount(totals.subtotal)}</span>
                  </div>
                  {Number(totals.discountTotal) > 0 ? (
                    <div className={styles.totalRow}>
                      <span>Discount</span>
                      <span>-{formatAmount(totals.discountTotal)}</span>
                    </div>
                  ) : null}
                  {Number(totals.taxTotal) > 0 ? (
                    <div className={styles.totalRow}>
                      <span>{taxLabel || 'Tax'}</span>
                      <span>{formatAmount(totals.taxTotal)}</span>
                    </div>
                  ) : null}
                  <div className={`${styles.totalRow} ${styles.totalStrong}`}>
                    <span>Total ({currency})</span>
                    <span>{formatAmount(totals.total)}</span>
                  </div>
                </>
              ) : (
                <p className={styles.muted}>
                  Check the numbers: a discount or percentage is not valid.
                </p>
              )}
            </div>
            <PrintPreview source={{ kind: 'draft', build: draftBody }} label={label} />
            {nav(`Save ${label}`)}
          </div>
        ) : null}
      </WizardCard>

      {problem || command.error ? (
        <ErrorState
          title={command.error ? 'This was not saved' : 'Please check'}
          message={command.error ?? problem ?? ''}
        />
      ) : null}
      {command.stepUp}
    </form>
  );
}
