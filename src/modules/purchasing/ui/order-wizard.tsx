'use client';

import { useState } from 'react';
import { Select } from '@/design-system/forms';
import { Button, ErrorState, Field } from '@/design-system/primitives';
import {
  WizardActions,
  WizardPair,
  WizardStep,
  WIZARD_REVIEW_HINT,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
} from '@/design-system/wizard';
import { checkOrderDates, checkOrderFuel, checkOrderSupplier } from '../order-checks';
import { checkOrderLines, todayBusinessDate, type OrderLineInput } from './purchasing-format';
import type { OrderReference } from './purchasing-types';

type OrderStep = 'supplier' | 'fuel' | 'dates' | 'notes' | 'review';

export type NewOrderValue = {
  supplierId: string;
  orderDate: string;
  expected: string;
  notes: string;
  lines: OrderLineInput[];
};

function blankLine(reference: OrderReference | null): OrderLineInput {
  const only = reference?.products.length === 1 ? reference.products[0] : undefined;
  return { productId: only?.id ?? '', litres: '', price: '' };
}

/** Order fuel one question at a time, ending in a check screen. */
export function OrderWizard({
  reference,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  reference: OrderReference | null;
  busy: boolean;
  /** A problem from saving, shown on the check screen. */
  error: string | null;
  onCancel: () => void;
  onSubmit: (value: NewOrderValue) => void;
}) {
  const suppliers = reference?.suppliers ?? [];
  const products = reference?.products ?? [];
  const [supplierId, setSupplierId] = useState(
    suppliers.length === 1 ? (suppliers[0]?.id ?? '') : '',
  );
  const [orderDate, setOrderDate] = useState(todayBusinessDate());
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<OrderLineInput[]>([blankLine(reference)]);

  const sequence: readonly OrderStep[] = ['supplier', 'fuel', 'dates', 'notes', 'review'];
  const wizard = useWizard<OrderStep>({ start: 'supplier', sequence, onCancel });
  const { step, errors } = wizard;

  const unitOf = (productId: string) => products.find((p) => p.id === productId)?.unit;
  const unitWord = (productId: string) =>
    unitOf(productId) === 'KILOGRAMS' ? 'kilograms' : 'litres';
  const updateLine = (index: number, patch: Partial<OrderLineInput>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  function next() {
    if (step === 'supplier') {
      return wizard.advance(checkOrderSupplier(supplierId), 'fuel', 'review');
    }
    if (step === 'fuel') return wizard.advance(checkOrderFuel(lines, unitOf), 'dates', 'review');
    if (step === 'dates')
      return wizard.advance(checkOrderDates(orderDate, expected), 'notes', 'review');
    if (step === 'notes') return wizard.advance({}, 'review');
    const checked = checkOrderLines(lines, unitOf);
    if (!checked.ok) return wizard.change('fuel');
    onSubmit({ supplierId, orderDate, expected, notes: notes.trim(), lines });
  }

  const supplierName = suppliers.find((s) => s.id === supplierId)?.legalName ?? '';
  const when = (date: string) => (date ? new Date(`${date}T00:00:00`).toLocaleDateString() : '');

  return (
    <form
      className="form-stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {step === 'supplier' ? (
        <WizardStep
          wizard={wizard}
          title="Who are you ordering from?"
          hint="The order stays a draft until you send it for approval."
        >
          <Field
            id="po-supplier"
            label="Supplier"
            error={errors['po-supplier']}
            required
            hint={
              suppliers.length === 0
                ? 'There are no active suppliers yet. Add one on the Suppliers page first.'
                : undefined
            }
          >
            <Select
              id="po-supplier"
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
              placeholder="Choose a supplier"
              options={suppliers.map((s) => ({ value: s.id, label: s.legalName }))}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'fuel' ? (
        <WizardStep
          wizard={wizard}
          title="What fuel do you want?"
          hint="The agreed price is used later to check the supplier's invoice. Leave it empty if you have not agreed one."
        >
          {lines.map((line, index) => (
            <div key={index} className="form-stack">
              <Field
                id={`po-product-${index}`}
                label={index === 0 ? 'Fuel' : `Fuel ${index + 1}`}
                error={errors[`po-product-${index}`]}
                required
              >
                <Select
                  id={`po-product-${index}`}
                  value={line.productId}
                  onChange={(event) => updateLine(index, { productId: event.target.value })}
                  placeholder="Choose the fuel"
                  options={products.map((p) => ({ value: p.id, label: p.name }))}
                />
              </Field>
              <WizardPair>
                <Field
                  id={`po-litres-${index}`}
                  label={unitOf(line.productId) === 'KILOGRAMS' ? 'Kilograms' : 'Litres'}
                  error={errors[`po-litres-${index}`]}
                  required
                >
                  <input
                    id={`po-litres-${index}`}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="e.g. 10000"
                    value={line.litres}
                    onChange={(event) => updateLine(index, { litres: event.target.value })}
                  />
                </Field>
                <Field
                  id={`po-price-${index}`}
                  label={`Agreed price per ${unitOf(line.productId) === 'KILOGRAMS' ? 'kilogram' : 'litre'}`}
                  error={errors[`po-price-${index}`]}
                  optional
                >
                  <input
                    id={`po-price-${index}`}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="e.g. 1.45"
                    value={line.price}
                    onChange={(event) => updateLine(index, { price: event.target.value })}
                  />
                </Field>
              </WizardPair>
              {lines.length > 1 ? (
                <div>
                  <Button
                    type="button"
                    variant="quiet"
                    aria-label={`Remove fuel ${index + 1}`}
                    onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
          <div>
            <Button
              type="button"
              id="po-add-line"
              variant="secondary"
              onClick={() => setLines((current) => [...current, blankLine(reference)])}
            >
              Add another fuel
            </Button>
          </div>
          {errors['po-add-line'] ? <p role="alert">{errors['po-add-line']}</p> : null}
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'dates' ? (
        <WizardStep
          wizard={wizard}
          title="When is it for?"
          hint="The day you order it, and the day you expect it."
        >
          <WizardPair>
            <Field id="po-date" label="Order date" error={errors['po-date']} required>
              <input
                id="po-date"
                type="date"
                value={orderDate}
                onChange={(event) => setOrderDate(event.target.value)}
              />
            </Field>
            <Field id="po-expected" label="Fuel expected by" error={errors['po-expected']} optional>
              <input
                id="po-expected"
                type="date"
                value={expected}
                min={orderDate}
                onChange={(event) => setExpected(event.target.value)}
              />
            </Field>
          </WizardPair>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'notes' ? (
        <WizardStep
          wizard={wizard}
          title="Anything to add?"
          hint="You can leave this empty and carry on."
        >
          <Field id="po-notes" label="Notes for yourself or the supplier" optional>
            <textarea
              id="po-notes"
              rows={3}
              maxLength={1000}
              autoFocus
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
          <WizardActions wizard={wizard} onContinue={next} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check the order" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            <WizardSummaryRow label="Supplier" onChange={() => wizard.change('supplier')}>
              {supplierName}
            </WizardSummaryRow>
            <WizardSummaryRow label="Fuel" onChange={() => wizard.change('fuel')}>
              {lines
                .map((line) => {
                  const name = products.find((p) => p.id === line.productId)?.name ?? '';
                  const price = line.price.trim() ? ` at ${line.price.trim()}` : '';
                  return `${name}: ${line.litres.trim()} ${unitWord(line.productId)}${price}`;
                })
                .join(' · ')}
            </WizardSummaryRow>
            <WizardSummaryRow label="Dates" onChange={() => wizard.change('dates')}>
              {expected
                ? `Ordered ${when(orderDate)}, expected by ${when(expected)}`
                : `Ordered ${when(orderDate)}`}
            </WizardSummaryRow>
            <WizardSummaryRow label="Notes" onChange={() => wizard.change('notes')}>
              {notes.trim() || 'None'}
            </WizardSummaryRow>
          </WizardSummary>
          {error ? <ErrorState title="Could not save" message={error} /> : null}
          <WizardActions wizard={wizard} onContinue={next} continueLabel="Save order" busy={busy} />
        </WizardStep>
      ) : null}
    </form>
  );
}
