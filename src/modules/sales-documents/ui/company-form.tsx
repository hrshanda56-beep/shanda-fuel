'use client';

import { Modal } from '@/design-system/modal';
import type { SalesDocumentProfileView } from '../queries';
import { CompanyWizard, type CompanyValue } from './company-wizard';
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

  const initial: CompanyValue = {
    displayName: profile?.displayName ?? defaultName,
    address: profile?.address ?? '',
    phone: profile?.phone ?? '',
    email: profile?.email ?? '',
    logo: profile?.logoJpegBase64 ?? null,
    appLogo: profile?.appLogoPngBase64 ?? null,
    colour: profile?.brandColour ?? null,
    taxLabel: profile?.taxLabel ?? 'VAT',
    taxNumber: profile?.taxNumber ?? '',
    taxRate: trim(profile?.defaultTaxRate ?? '0'),
    bank: profile?.bankDetails ?? '',
    terms: profile?.defaultTerms ?? '',
    footer: profile?.footer ?? '',
    qt: profile?.quotationPrefix ?? 'QT',
    inv: profile?.invoicePrefix ?? 'INV',
    rc: profile?.receiptPrefix ?? 'RC',
    validDays: String(profile?.defaultValidDays ?? 30),
    dueDays: String(profile?.defaultDueDays ?? 30),
  };

  function submit(value: CompanyValue) {
    void command.send(
      {
        commandType: 'SaveSalesDocProfile',
        tenantId,
        legalEntityId,
        ...(profile ? { expectedVersion: profile.version } : {}),
        displayName: value.displayName,
        address: value.address,
        phone: value.phone,
        email: value.email,
        taxLabel: value.taxLabel,
        taxNumber: value.taxNumber,
        defaultTaxRate: value.taxRate || '0',
        bankDetails: value.bank,
        defaultTerms: value.terms,
        footer: value.footer,
        logoJpegBase64: value.logo,
        appLogoPngBase64: value.appLogo,
        brandColour: value.colour,
        quotationPrefix: value.qt,
        invoicePrefix: value.inv,
        receiptPrefix: value.rc,
        defaultValidDays: Number(value.validDays) || 0,
        defaultDueDays: Number(value.dueDays) || 0,
      },
      () => onSaved(),
    );
  }

  return (
    <Modal
      open={open}
      onClose={() => !command.busy && onClose()}
      title="Your company details"
      presentation="page"
      backLabel="Documents"
    >
      <CompanyWizard
        initial={initial}
        existing={profile !== null}
        busy={command.busy}
        error={command.error}
        onCancel={onClose}
        onSubmit={submit}
      />
      {command.stepUp}
    </Modal>
  );
}
