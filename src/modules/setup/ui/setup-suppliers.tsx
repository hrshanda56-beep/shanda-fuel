'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Select } from '@/design-system/forms';
import { Field, StatusBadge } from '@/design-system/primitives';

import type { SetupOverview, SetupSupplier } from '../contracts';
import { SETUP_COMMANDS, sendCommand } from './setup-api';
import { FormModal, NotEntered, Row, RowList, SetupSection, text } from './setup-ui';

export function SuppliersSection({ data, reload }: { data: SetupOverview; reload: () => void }) {
  const [editing, setEditing] = useState<SetupSupplier | null>(null);
  if (data.suppliers === null) return null;
  const canManage = data.capabilities.suppliers;
  return (
    <SetupSection
      id="setup-suppliers"
      title="Suppliers"
      note="Correct a supplier's details or stop using one. History is kept."
      action={
        canManage ? (
          <Link className="button button-secondary button-sm" href="/suppliers">
            Add on Suppliers page
          </Link>
        ) : undefined
      }
    >
      {data.suppliers.length === 0 ? (
        <NotEntered what="supplier" />
      ) : (
        <RowList label="Suppliers">
          {data.suppliers.map((supplier) => (
            <Row
              key={supplier.id}
              title={supplier.legalName}
              badge={
                <StatusBadge tone={supplier.status === 'ACTIVE' ? 'positive' : 'neutral'}>
                  {supplier.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                </StatusBadge>
              }
              details={[
                { label: 'Code', value: supplier.code },
                { label: 'Registration', value: supplier.registrationReference ?? 'Not entered' },
              ]}
              onOpen={canManage ? () => setEditing(supplier) : undefined}
              openLabel={`Edit supplier ${supplier.legalName}`}
            />
          ))}
        </RowList>
      )}
      <FormModal
        key={editing?.id ?? 'none'}
        open={editing !== null}
        title="Edit supplier"
        description="Making a supplier inactive stops it being offered for new work. Existing records stay."
        submitLabel="Save supplier"
        onClose={() => setEditing(null)}
        onDone={() => {
          setEditing(null);
          reload();
        }}
        onSubmit={(form, key) =>
          editing
            ? sendCommand(
                SETUP_COMMANDS,
                {
                  commandType: 'UpdateSupplier',
                  tenantId: data.tenantId,
                  stationId: data.stationId,
                  supplierId: editing.id,
                  expectedVersion: editing.version,
                  legalName: text(form, 'name'),
                  registrationReference: text(form, 'registration') || null,
                  status: text(form, 'status'),
                },
                key,
              )
            : Promise.resolve({ ok: false as const, status: 0, message: 'No supplier selected.' })
        }
      >
        <Field id="supplier-name" label="Legal name" required>
          <input
            id="supplier-name"
            name="name"
            defaultValue={editing?.legalName}
            maxLength={240}
            autoComplete="off"
          />
        </Field>
        <Field id="supplier-registration" label="Registration reference, optional">
          <input
            id="supplier-registration"
            name="registration"
            defaultValue={editing?.registrationReference ?? ''}
            maxLength={120}
            autoComplete="off"
          />
        </Field>
        <Field id="supplier-status" label="Status" required>
          <Select
            id="supplier-status"
            name="status"
            defaultValue={editing?.status ?? 'ACTIVE'}
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
            ]}
          />
        </Field>
      </FormModal>
    </SetupSection>
  );
}
