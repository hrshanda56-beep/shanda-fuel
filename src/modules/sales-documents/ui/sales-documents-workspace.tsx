'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, EmptyState, SuccessState } from '@/design-system/primitives';
import type {
  SalesDocumentCapabilities,
  SalesDocumentDetail,
  SalesDocumentFuelOption,
  SalesDocumentListRow,
  SalesDocumentProfileView,
} from '../queries';
import { CompanyForm } from './company-form';
import { DocumentDetail } from './document-detail';
import { DocumentEditor } from './document-editor';
import { DocumentList } from './document-list';
import styles from './sales-documents.module.css';

export type SalesDocumentsInitial = {
  tenantId: string;
  legalEntityId: string;
  defaultCompanyName: string;
  capabilities: SalesDocumentCapabilities;
  profile: SalesDocumentProfileView | null;
  customers: { customerId: string; name: string }[];
  fuels: SalesDocumentFuelOption[];
  rows: SalesDocumentListRow[];
  /** Which screen the address asks for. */
  mode: 'list' | 'new' | 'edit' | 'view';
  newType: 'QUOTATION' | 'INVOICE';
  detail: SalesDocumentDetail | null;
};

const BASE = '/sales-documents';

/**
 * Quotations, invoices and receipts. Standalone: nothing here changes customer accounts, cash,
 * profit or any report. The address (`?doc=`, `?new=`, `?edit=`) says which screen is showing, so
 * the browser's back button and a copied link both work.
 */
export function SalesDocumentsWorkspace({ initial }: { initial: SalesDocumentsInitial }) {
  const router = useRouter();
  const params = useSearchParams();
  const [notice, setNotice] = useState<string | null>(null);
  const [companyOpen, setCompanyOpen] = useState(false);
  const wantsCompany = params.get('company') === '1';
  // Opened after the page has loaded, so the server and browser render the same thing first.
  useEffect(() => {
    if (wantsCompany) setCompanyOpen(true);
  }, [wantsCompany]);
  const { capabilities, profile, tenantId, legalEntityId } = initial;

  const go = (query: string) => router.push(query ? `${BASE}?${query}` : BASE);
  const reload = () => router.refresh();

  if (initial.mode !== 'list' && !profile) {
    // Cannot happen through the buttons (they ask for company details first); a pasted link lands here.
    return (
      <div className={styles.page}>
        <EmptyState
          title="Set up your company details first"
          message="They are printed at the top of every document."
          action={<Button onClick={() => go('')}>Back</Button>}
        />
      </div>
    );
  }

  const head = (
    <div className={styles.head}>
      <div className={styles.actions}>
        {initial.mode !== 'list' ? (
          <Button variant="quiet" onClick={() => go('')}>
            ← All documents
          </Button>
        ) : null}
      </div>
      {initial.mode === 'list' ? (
        <div className={styles.actions}>
          {capabilities.create ? (
            <>
              <Button onClick={() => (profile ? go('new=QUOTATION') : setCompanyOpen(true))}>
                New quotation
              </Button>
              <Button
                variant="secondary"
                onClick={() => (profile ? go('new=INVOICE') : setCompanyOpen(true))}
              >
                New invoice
              </Button>
            </>
          ) : null}
          {capabilities.manageProfile ? (
            <Button variant="quiet" onClick={() => setCompanyOpen(true)}>
              Company details
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className={styles.page}>
      {head}
      {notice ? <SuccessState title="Done" message={notice} /> : null}

      {initial.mode === 'list' ? (
        profile ? (
          <DocumentList rows={initial.rows} onOpen={(id) => go(`doc=${id}`)} />
        ) : (
          <EmptyState
            title="Set up your company details"
            message={
              capabilities.manageProfile
                ? 'Add your company name and address once. They are printed at the top of every quotation, invoice and receipt.'
                : 'Ask the owner to add the company details. They are printed at the top of every document.'
            }
            action={
              capabilities.manageProfile ? (
                <Button onClick={() => setCompanyOpen(true)}>Add company details</Button>
              ) : undefined
            }
          />
        )
      ) : null}

      {(initial.mode === 'new' || initial.mode === 'edit') && profile ? (
        <DocumentEditor
          key={initial.detail?.id ?? initial.newType}
          tenantId={tenantId}
          legalEntityId={legalEntityId}
          docType={
            initial.mode === 'edit' && initial.detail?.docType !== 'RECEIPT'
              ? (initial.detail?.docType as 'QUOTATION' | 'INVOICE')
              : initial.newType
          }
          existing={initial.mode === 'edit' ? initial.detail : null}
          profile={profile}
          customers={initial.customers}
          fuels={initial.fuels}
          onSaved={(id) => {
            setNotice('Saved as a draft. Check it, then issue it when it is ready.');
            go(`doc=${id}`);
          }}
          onCancel={() => (initial.detail ? go(`doc=${initial.detail.id}`) : go(''))}
        />
      ) : null}

      {initial.mode === 'view' && initial.detail ? (
        <DocumentDetail
          key={`${initial.detail.id}-${initial.detail.version}`}
          tenantId={tenantId}
          legalEntityId={legalEntityId}
          doc={initial.detail}
          capabilities={capabilities}
          onOpen={(id) => go(`doc=${id}`)}
          onEdit={() => go(`edit=${initial.detail!.id}`)}
          onChanged={(message, id) => {
            setNotice(message);
            if (id && id !== initial.detail!.id) go(`doc=${id}`);
            else reload();
          }}
        />
      ) : null}

      <CompanyForm
        key={profile?.version ?? 'new'}
        open={companyOpen}
        tenantId={tenantId}
        legalEntityId={legalEntityId}
        profile={profile}
        defaultName={initial.defaultCompanyName}
        onClose={() => setCompanyOpen(false)}
        onSaved={() => {
          setCompanyOpen(false);
          setNotice('Company details saved.');
          reload();
        }}
      />
    </div>
  );
}
