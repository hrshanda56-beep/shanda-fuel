'use client';

import { useState } from 'react';

import { Button, Field, StatusBadge } from '@/design-system/primitives';

import type { SetupOverview } from '../contracts';
import { SETUP_COMMANDS, sendCommand } from './setup-api';
import { FormModal, NotEntered, Row, RowList, SetupSection, text } from './setup-ui';

export function ProductsSection({ data, reload }: { data: SetupOverview; reload: () => void }) {
  const [open, setOpen] = useState(false);
  if (data.products === null) return null;
  return (
    <SetupSection
      id="setup-products"
      title="Fuel products"
      note="The fuels this organisation sells, such as diesel or petrol. Shared by every station."
      action={
        data.capabilities.products ? (
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            Add product
          </Button>
        ) : undefined
      }
    >
      {data.products.length === 0 ? (
        <NotEntered what="fuel product" />
      ) : (
        <RowList label="Fuel products">
          {data.products.map((product) => (
            <Row
              key={product.id}
              title={product.name}
              badge={
                <StatusBadge tone={product.status === 'ACTIVE' ? 'positive' : 'neutral'}>
                  {product.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                </StatusBadge>
              }
              details={[{ label: 'Code', value: product.code }]}
            />
          ))}
        </RowList>
      )}
      <FormModal
        open={open}
        title="Add fuel product"
        description="Use the same code your suppliers and reports use."
        submitLabel="Add product"
        onClose={() => setOpen(false)}
        onDone={() => {
          setOpen(false);
          reload();
        }}
        onSubmit={(form, key) =>
          sendCommand(
            SETUP_COMMANDS,
            {
              commandType: 'CreateProduct',
              tenantId: data.tenantId,
              stationId: data.stationId,
              code: text(form, 'code'),
              name: text(form, 'name'),
            },
            key,
          )
        }
      >
        <Field id="product-name" label="Name" required>
          <input id="product-name" name="name" maxLength={120} autoComplete="off" />
        </Field>
        <Field id="product-code" label="Code" hint="Short and unique, for example DSL." required>
          <input id="product-code" name="code" maxLength={32} autoComplete="off" />
        </Field>
      </FormModal>
    </SetupSection>
  );
}
