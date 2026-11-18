'use client';

import { useState, type FormEvent } from 'react';
import { Button, ErrorState, Field, NumericInput } from '@/design-system/primitives';
import { Modal } from '@/design-system/modal';
import type { SalesDocumentProfileView } from '../queries';
import styles from './sales-documents.module.css';
import { useSalesCommand } from './use-sales-command';

const trim = (value: string): string =>
  value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;

/** The details printed at the top of every document, plus how numbers and dates are set. */
export function CompanyForm({
  open,
  tenantId,
  legalEntityId,
  profile,
  defaultName,
  onClose,
  onSaved,
}: {
  open: boolean;
  tenantId: string;
  legalEntityId: string;
  profile: SalesDocumentProfileView | null;
  defaultName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const command = useSalesCommand(tenantId);
  const [displayName, setDisplayName] = useState(profile?.displayName ?? defaultName);
  const [address, setAddress] = useState(profile?.address ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [email, setEmail] = useState(profile?.email ?? '');
  const [taxLabel, setTaxLabel] = useState(profile?.taxLabel ?? 'VAT');
  const [taxNumber, setTaxNumber] = useState(profile?.taxNumber ?? '');
  const [taxRate, setTaxRate] = useState(trim(profile?.defaultTaxRate ?? '0'));
  const [bank, setBank] = useState(profile?.bankDetails ?? '');
  const [terms, setTerms] = useState(profile?.defaultTerms ?? '');
  const [footer, setFooter] = useState(profile?.footer ?? '');
  const [qt, setQt] = useState(profile?.quotationPrefix ?? 'QT');
  const [inv, setInv] = useState(profile?.invoicePrefix ?? 'INV');
  const [rc, setRc] = useState(profile?.receiptPrefix ?? 'RC');
  const [validDays, setValidDays] = useState(String(profile?.defaultValidDays ?? 30));
  const [dueDays, setDueDays] = useState(String(profile?.defaultDueDays ?? 30));

  function submit(event: FormEvent) {
    event.preventDefault();
    void command.send(
      {
        commandType: 'SaveSalesDocProfile',
        tenantId,
        legalEntityId,
        ...(profile ? { expectedVersion: profile.version } : {}),
        displayName,
        address,
        phone,
        email,
        taxLabel,
        taxNumber,
        defaultTaxRate: taxRate || '0',
        bankDetails: bank,
        defaultTerms: terms,
        footer,
        quotationPrefix: qt,
        invoicePrefix: inv,
        receiptPrefix: rc,
        defaultValidDays: Number(validDays) || 0,
        defaultDueDays: Number(dueDays) || 0,
      },
      () => onSaved(),
    );
  }

  return (
    <Modal
      open={open}
      onClose={() => !command.busy && onClose()}
      title="Your company details"
      description="These are printed at the top of every quotation, invoice and receipt."
      presentation="side"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={command.busy}>
            Cancel
          </Button>
          <Button type="submit" form="sd-company-form" loading={command.busy}>
            Save details
          </Button>
        </>
      }
    >
      <form id="sd-company-form" onSubmit={submit} className={styles.page}>
        <Field id="sd-c-name" label="Company name" required>
          <input
            id="sd-c-name"
            value={displayName}
            maxLength={200}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </Field>
        <Field id="sd-c-address" label="Address" optional>
          <textarea
            id="sd-c-address"
            rows={2}
            value={address}
            maxLength={500}
            onChange={(e) => setAddress(e.target.value)}
          />
        </Field>
        <div className={styles.grid2}>
          <Field id="sd-c-phone" label="Phone" optional>
            <input
              id="sd-c-phone"
              value={phone}
              maxLength={60}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Field id="sd-c-email" label="Email" optional>
            <input
              id="sd-c-email"
              value={email}
              maxLength={200}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        </div>
        <div className={styles.grid2}>
          <Field
            id="sd-c-taxlabel"
            label="Name of your tax"
            hint="For example VAT, GST or Sales tax."
          >
            <input
              id="sd-c-taxlabel"
              value={taxLabel}
              maxLength={30}
              onChange={(e) => setTaxLabel(e.target.value)}
            />
          </Field>
          <Field id="sd-c-taxno" label="Your tax number" optional>
            <input
              id="sd-c-taxno"
              value={taxNumber}
              maxLength={60}
              onChange={(e) => setTaxNumber(e.target.value)}
            />
          </Field>
        </div>
        <NumericInput
          id="sd-c-rate"
          label="Usual tax percentage"
          hint="Filled in on new items. Use 0 if you do not charge tax. You can change it on any item."
          unit="%"
          value={taxRate}
          onChange={(e) => setTaxRate(e.target.value)}
        />
        <Field id="sd-c-bank" label="Bank or payment details" hint="Printed on invoices." optional>
          <textarea
            id="sd-c-bank"
            rows={3}
            value={bank}
            maxLength={1000}
            onChange={(e) => setBank(e.target.value)}
          />
        </Field>
        <Field id="sd-c-terms" label="Usual terms" hint="Filled in on new documents." optional>
          <textarea
            id="sd-c-terms"
            rows={3}
            value={terms}
            maxLength={2000}
            onChange={(e) => setTerms(e.target.value)}
          />
        </Field>
        <Field id="sd-c-footer" label="Line at the bottom" optional>
          <input
            id="sd-c-footer"
            value={footer}
            maxLength={500}
            onChange={(e) => setFooter(e.target.value)}
          />
        </Field>
        <div className={styles.grid2}>
          <Field id="sd-c-qt" label="Quotation numbers start with" hint="QT gives QT-2026-0001.">
            <input id="sd-c-qt" value={qt} maxLength={10} onChange={(e) => setQt(e.target.value)} />
          </Field>
          <Field id="sd-c-inv" label="Invoice numbers start with">
            <input
              id="sd-c-inv"
              value={inv}
              maxLength={10}
              onChange={(e) => setInv(e.target.value)}
            />
          </Field>
          <Field id="sd-c-rc" label="Receipt numbers start with">
            <input id="sd-c-rc" value={rc} maxLength={10} onChange={(e) => setRc(e.target.value)} />
          </Field>
        </div>
        <div className={styles.grid2}>
          <NumericInput
            id="sd-c-valid"
            label="Quotations are valid for"
            unit="days"
            value={validDays}
            onChange={(e) => setValidDays(e.target.value.replace(/\D/g, ''))}
          />
          <NumericInput
            id="sd-c-due"
            label="Invoices are due within"
            unit="days"
            value={dueDays}
            onChange={(e) => setDueDays(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        {command.error ? <ErrorState title="Not saved" message={command.error} /> : null}
      </form>
      {command.stepUp}
    </Modal>
  );
}
