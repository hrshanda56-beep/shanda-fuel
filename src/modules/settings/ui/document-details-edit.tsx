'use client';

import { useState } from 'react';

import { useToast } from '@/design-system/feedback-provider';
import { Button } from '@/design-system/primitives';
import type { SalesDocumentProfileView } from '@/modules/sales-documents/queries';
import { CompanyForm } from '@/modules/sales-documents/ui/company-form';

/**
 * "Edit details" for the name, address, tax number and bank details printed on a company's
 * quotations, invoices and receipts. The company-details guide opens right here; the saved details
 * are read when the button is pressed, so this page does not load them for every company.
 */
export function EditDocumentDetails({
  tenantId,
  company,
}: {
  tenantId: string;
  company: { id: string; name: string };
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [profile, setProfile] = useState<SalesDocumentProfileView | null>(null);

  async function begin() {
    setLoading(true);
    setProblem(null);
    try {
      const params = new URLSearchParams({ tenantId, legalEntityId: company.id });
      const response = await fetch(`/api/sales-documents/profile?${params}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const result = (await response.json().catch(() => ({}))) as {
        profile?: SalesDocumentProfileView | null;
        message?: string;
      };
      if (!response.ok) {
        setProblem(result.message ?? 'The details could not be loaded. Please try again.');
        return;
      }
      setProfile(result.profile ?? null);
      setOpen(true);
    } catch {
      setProblem('We could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-haspopup="dialog"
        aria-label={`Edit details for ${company.name}`}
        loading={loading}
        onClick={() => void begin()}
      >
        Edit details
      </Button>
      {problem ? (
        <p className="field-error" role="alert">
          {problem}
        </p>
      ) : null}
      <CompanyForm
        open={open}
        tenantId={tenantId}
        legalEntityId={company.id}
        profile={profile}
        defaultName={company.name}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          toast.success(`${company.name}: document details saved.`);
        }}
      />
    </>
  );
}
