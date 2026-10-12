'use client';

import { useState } from 'react';

import { Select } from '@/design-system/forms';
import { Button, Field } from '@/design-system/primitives';

import type { SetupOverview } from '../contracts';
import { INVENTORY_COMMANDS, formatLitres, sendCommand } from './setup-api';
import { FormModal, NotEntered, Row, RowList, SetupSection, text } from './setup-ui';

const LITRES = String.raw`\d+(\.\d{1,3})?`;

export function TanksSection({ data, reload }: { data: SetupOverview; reload: () => void }) {
  const [open, setOpen] = useState(false);
  if (data.tanks === null) return null;
  const products = data.products ?? [];
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? 'Unknown product';
  const canAdd = data.capabilities.tanks;
  return (
    <SetupSection
      id="setup-tanks"
      title="Tanks"
      note="Each tank holds one product. Deliveries can only be received into a tank that is entered here."
      action={
        canAdd ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setOpen(true)}
            disabled={products.length === 0}
          >
            Add tank
          </Button>
        ) : undefined
      }
    >
      {canAdd && products.length === 0 ? (
        <p className="field-hint">Add a fuel product first.</p>
      ) : null}
      {data.tanks.length === 0 ? (
        <NotEntered what="tank" hint="No tank is entered, so fuel deliveries cannot be received." />
      ) : (
        <RowList label="Tanks">
          {data.tanks.map((tank) => (
            <Row
              key={tank.id}
              title={`Tank ${tank.code}`}
              details={[
                { label: 'Product', value: productName(tank.productId) },
                { label: 'Capacity', value: formatLitres(tank.capacityLitres) },
                { label: 'Reorder level', value: formatLitres(tank.reorderLevelLitres) },
                { label: 'Allowed variance', value: formatLitres(tank.acceptableVarianceLitres) },
              ]}
            />
          ))}
        </RowList>
      )}
      <FormModal
        open={open}
        title="Add tank"
        description="Capacity is required. Reorder level and allowed variance can be added now or left as not entered."
        submitLabel="Add tank"
        onClose={() => setOpen(false)}
        onDone={() => {
          setOpen(false);
          reload();
        }}
        onSubmit={(form, key) => {
          const reorder = text(form, 'reorder');
          const variance = text(form, 'variance');
          return sendCommand(
            INVENTORY_COMMANDS,
            {
              commandType: 'CreateTank',
              tenantId: data.tenantId,
              stationId: data.stationId,
              code: text(form, 'code'),
              productId: text(form, 'product'),
              capacityLitres: text(form, 'capacity'),
              ...(reorder ? { reorderLevelLitres: reorder } : {}),
              ...(variance ? { acceptableVarianceLitres: variance } : {}),
            },
            key,
          );
        }}
      >
        <Field id="tank-code" label="Tank name or number" required>
          <input id="tank-code" name="code" maxLength={32} autoComplete="off" />
        </Field>
        <Field id="tank-product" label="Product" required>
          <Select
            id="tank-product"
            name="product"
            defaultValue=""
            placeholder="Choose a product"
            options={products
              .filter((p) => p.status === 'ACTIVE')
              .map((p) => ({ value: p.id, label: p.name }))}
          />
        </Field>
        <Field id="tank-capacity" label="Capacity (litres)" required>
          <input
            id="tank-capacity"
            name="capacity"
            inputMode="decimal"
            pattern={LITRES}
            autoComplete="off"
          />
        </Field>
        <Field id="tank-reorder" label="Reorder level, optional (litres)">
          <input
            id="tank-reorder"
            name="reorder"
            inputMode="decimal"
            pattern={LITRES}
            autoComplete="off"
          />
        </Field>
        <Field
          id="tank-variance"
          label="Allowed variance, optional (litres)"
          hint="The dip difference you accept before it is flagged."
        >
          <input
            id="tank-variance"
            name="variance"
            inputMode="decimal"
            pattern={LITRES}
            autoComplete="off"
          />
        </Field>
      </FormModal>
    </SetupSection>
  );
}
