'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button, Card, ErrorState, Field, NumericInput } from '@/design-system/primitives';
import { Select } from '@/design-system/forms';
import { todayInBusinessTime } from '@/modules/expenses/ui/expense-format';
import { MAX_DOCUMENT_LINES } from '../contracts';
import { computeDocumentTotals, lineGross } from '../domain';
import { DOC_LABELS, addDays, formatAmount } from '../format';
import type {
  SalesDocumentDetail,
  SalesDocumentFuelOption,
  SalesDocumentProfileView,
} from '../queries';
import styles from './sales-documents.module.css';
import { useSalesCommand } from './use-sales-command';

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

const lineAmount = (line: Line): string => {
  try {
    if (!/^\d+(\.\d+)?$/.test(line.quantity) || !/^\d+(\.\d+)?$/.test(line.unitPrice)) return '';
    return formatAmount(lineGross(line.quantity, line.unitPrice));
  } catch {
    return '';
  }
};

const trimZeros = (value: string): string =>
  value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;

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
  const [problem, setProblem] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [focusId, setFocusId] = useState<string | null>(null);
  const currency = existing?.currency ?? 'USD';
  const lastFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId || focusId === lastFocus.current) return;
    lastFocus.current = focusId;
    const element = document.getElementById(focusId);
    element?.focus();
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFocusId(null);
    lastFocus.current = null;
  }, [focusId]);

  const fuelChoices = useMemo(
    () =>
      fuels.flatMap((fuel) => {
        const here = stationId ? fuel.prices.filter((price) => price.stationId === stationId) : [];
        const prices = here.length > 0 ? here : fuel.prices;
        const scoped = here.length > 0;
        if (prices.length === 0) {
          return [{ value: `${fuel.productId}|`, label: fuel.name, fuel, price: '', suffix: '' }];
        }
        return prices.map((price) => {
          const many = !scoped && prices.length > 1;
          return {
            value: `${fuel.productId}|${price.stationId}`,
            label: many
              ? `${fuel.name} - ${price.stationName} (${formatAmount(price.unitPrice, 4, 2)})`
              : `${fuel.name} (${formatAmount(price.unitPrice, 4, 2)})`,
            fuel,
            price: price.unitPrice,
            suffix: many ? ` - ${price.stationName}` : '',
          };
        });
      }),
    [fuels, stationId],
  );

  const totals = useMemo(() => {
    try {
      const ready = lines.filter((line) => line.quantity && line.unitPrice);
      return computeDocumentTotals(
        ready.map((line) => ({
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount || '0',
          taxRate: line.taxRate || '0',
        })),
      );
    } catch {
      return null;
    }
  }, [lines]);

  function patch(key: number, change: Partial<Line>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...change } : line)),
    );
  }

  function addFuel(value: string) {
    const choice = fuelChoices.find((option) => option.value === value);
    if (!choice) return;
    setLines((current) => [
      ...current.filter((line) => line.description || line.unitPrice),
      {
        ...blankLine(trimZeros(profile.defaultTaxRate)),
        productId: choice.fuel.productId,
        description: `${choice.fuel.name}${choice.suffix}`,
        unitLabel: choice.fuel.unit === 'KILOGRAMS' ? 'kg' : 'L',
        unitPrice: trimZeros(choice.price),
        quantity: '',
      },
    ]);
  }

  function addBlankLine() {
    const line = blankLine(trimZeros(profile.defaultTaxRate));
    setLines((current) => [...current, line]);
    setFocusId(`sd-desc-${line.key}`);
  }

  function duplicateLine(key: number) {
    setLines((current) => {
      const index = current.findIndex((line) => line.key === key);
      if (index < 0 || current.length >= MAX_DOCUMENT_LINES) return current;
      const copy = { ...current[index]!, key: nextKey++ };
      return [...current.slice(0, index + 1), copy, ...current.slice(index + 1)];
    });
  }

  function validate(): { found: Record<string, string>; first: string | null } {
    const found: Record<string, string> = {};
    const order: string[] = [];
    const flag = (id: string, message: string) => {
      if (!found[id]) order.push(id);
      found[id] = message;
    };
    if (!name.trim()) flag('sd-name', `Who is this ${label} for? Add a name.`);
    const amountOk = (value: string) => /^\d+(\.\d+)?$/.test(value.trim());
    for (const line of lines) {
      if (!line.description.trim()) flag(`sd-desc-${line.key}`, 'Describe this item.');
      if (!amountOk(line.quantity) || Number(line.quantity) <= 0) {
        flag(`sd-qty-${line.key}`, 'Enter a quantity above zero.');
      }
      if (!amountOk(line.unitPrice)) flag(`sd-price-${line.key}`, 'Enter the price each.');
      if (line.discountAmount && !amountOk(line.discountAmount)) {
        flag(`sd-disc-${line.key}`, 'Enter the discount as an amount, or 0.');
      }
      if (line.taxRate && (!amountOk(line.taxRate) || Number(line.taxRate) > 100)) {
        flag(`sd-rate-${line.key}`, 'Enter a percentage from 0 to 100.');
      }
      if (!found[`sd-qty-${line.key}`] && !found[`sd-price-${line.key}`]) {
        try {
          computeDocumentTotals([
            {
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountAmount: line.discountAmount || '0',
              taxRate: line.taxRate || '0',
            },
          ]);
        } catch {
          if (!found[`sd-disc-${line.key}`] && !found[`sd-rate-${line.key}`]) {
            flag(`sd-disc-${line.key}`, 'The discount cannot be more than this item costs.');
          }
        }
      }
    }
    return { found, first: order[0] ?? null };
  }

  function pickCustomer(id: string) {
    setCustomerId(id);
    const chosen = customers.find((customer) => customer.customerId === id);
    if (chosen) setName(chosen.name);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const { found, first } = validate();
    setErrors(found);
    if (first) {
      setProblem('Some details need attention. They are marked below.');
      return setFocusId(first);
    }
    if (!totals) return setProblem('Check the numbers on your lines. One of them is not valid.');
    void command.send(
      {
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
        lines: lines.map((line) => ({
          productId: line.productId,
          description: line.description,
          quantity: line.quantity,
          unitLabel: line.unitLabel,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount || '0',
          taxRate: line.taxRate || '0',
        })),
      },
      (result) => onSaved(String(result.documentId)),
    );
  }

  return (
    <form onSubmit={submit} className={styles.page} noValidate>
      <Card className={styles.card}>
        <h2 className={styles.sectionTitle}>Who is it for?</h2>
        <div className={styles.page}>
          {customers.length > 0 ? (
            <Field id="sd-customer" label="Saved customer" optional>
              <Select
                id="sd-customer"
                value={customerId}
                onChange={(event) => pickCustomer(event.target.value)}
                options={[
                  { value: '', label: 'Someone else (type their details)' },
                  ...customers.map((c) => ({ value: c.customerId, label: c.name })),
                ]}
              />
            </Field>
          ) : null}
          <Field id="sd-name" label="Name" required error={errors['sd-name']}>
            <input
              id="sd-name"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className={styles.grid2}>
            <Field id="sd-email" label="Email" optional>
              <input
                id="sd-email"
                value={email}
                maxLength={200}
                onChange={(e) => setEmail(e.target.value)}
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
          </div>
          <Field id="sd-address" label="Address" optional>
            <textarea
              id="sd-address"
              rows={2}
              value={address}
              maxLength={500}
              onChange={(e) => setAddress(e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card className={styles.card}>
        <h2 className={styles.sectionTitle}>Dates</h2>
        <div className={styles.grid2}>
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
        </div>
      </Card>

      <Card className={styles.card}>
        <h2 className={styles.sectionTitle}>What is it for?</h2>
        <div className={styles.page}>
          {lines.map((line, index) => (
            <div key={line.key} className={styles.lineCard}>
              <Field
                id={`sd-desc-${line.key}`}
                label={`Item ${index + 1}`}
                required
                error={errors[`sd-desc-${line.key}`]}
              >
                <input
                  id={`sd-desc-${line.key}`}
                  value={line.description}
                  maxLength={300}
                  placeholder="For example: Diesel, or Delivery fee"
                  onChange={(e) => patch(line.key, { description: e.target.value })}
                />
              </Field>
              <div className={styles.lineGrid}>
                <NumericInput
                  id={`sd-qty-${line.key}`}
                  label="Quantity"
                  required
                  error={errors[`sd-qty-${line.key}`]}
                  value={line.quantity}
                  onChange={(e) => patch(line.key, { quantity: e.target.value })}
                />
                <Field id={`sd-unit-${line.key}`} label="Unit" optional>
                  <input
                    id={`sd-unit-${line.key}`}
                    value={line.unitLabel}
                    maxLength={20}
                    placeholder="L, kg, each"
                    onChange={(e) => patch(line.key, { unitLabel: e.target.value })}
                  />
                </Field>
                <NumericInput
                  id={`sd-price-${line.key}`}
                  label="Price each"
                  required
                  error={errors[`sd-price-${line.key}`]}
                  value={line.unitPrice}
                  onChange={(e) => patch(line.key, { unitPrice: e.target.value })}
                />
                <NumericInput
                  id={`sd-disc-${line.key}`}
                  label={`Discount (${currency}, not %)`}
                  optional
                  error={errors[`sd-disc-${line.key}`]}
                  value={line.discountAmount}
                  onChange={(e) => patch(line.key, { discountAmount: e.target.value })}
                />
                <NumericInput
                  id={`sd-rate-${line.key}`}
                  label={`${taxLabel || 'Tax'} %`}
                  optional
                  error={errors[`sd-rate-${line.key}`]}
                  value={line.taxRate}
                  onChange={(e) => patch(line.key, { taxRate: e.target.value })}
                />
              </div>
              <div className={styles.lineFoot}>
                <span className={styles.muted}>
                  {lineAmount(line) ? `Line total: ${currency} ${lineAmount(line)}` : ''}
                  {line.productId ? ' · A fuel from your system. You can change the price.' : ''}
                </span>
                <span className={styles.actions}>
                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={lines.length >= MAX_DOCUMENT_LINES}
                    onClick={() => duplicateLine(line.key)}
                  >
                    Duplicate
                  </Button>
                  {lines.length > 1 ? (
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() => setLines((c) => c.filter((l) => l.key !== line.key))}
                    >
                      Remove
                    </Button>
                  ) : null}
                </span>
              </div>
            </div>
          ))}
          <div className={styles.actions}>
            <Button
              variant="secondary"
              disabled={lines.length >= MAX_DOCUMENT_LINES}
              onClick={addBlankLine}
            >
              Add an item
            </Button>
            {fuelChoices.length > 0 ? (
              <Select
                aria-label="Add a fuel from your system"
                value=""
                onChange={(event) => addFuel(event.target.value)}
                placeholder="Add a fuel…"
                options={fuelChoices.map((choice) => ({
                  value: choice.value,
                  label: choice.label,
                }))}
              />
            ) : null}
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
        </div>
      </Card>

      <Card className={styles.card}>
        <h2 className={styles.sectionTitle}>Extra details</h2>
        <div className={styles.page}>
          <Field id="sd-taxlabel" label="Name of the tax" hint="Printed on the document, e.g. VAT.">
            <input
              id="sd-taxlabel"
              value={taxLabel}
              maxLength={30}
              onChange={(e) => setTaxLabel(e.target.value)}
            />
          </Field>
          <Field id="sd-notes" label="Note to the customer" optional>
            <textarea
              id="sd-notes"
              rows={2}
              value={notes}
              maxLength={2000}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <Field id="sd-terms" label="Terms" optional>
            <textarea
              id="sd-terms"
              rows={3}
              value={terms}
              maxLength={2000}
              onChange={(e) => setTerms(e.target.value)}
            />
          </Field>
        </div>
      </Card>

      {problem || command.error ? (
        <ErrorState title="This was not saved" message={problem ?? command.error ?? ''} />
      ) : null}
      <div className={styles.actions}>
        <Button type="submit" loading={command.busy}>
          Save {label}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={command.busy}>
          Cancel
        </Button>
      </div>
      {command.stepUp}
    </form>
  );
}
