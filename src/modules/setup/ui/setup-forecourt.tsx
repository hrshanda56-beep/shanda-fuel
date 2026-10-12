'use client';

import { useState } from 'react';

import { Select } from '@/design-system/forms';
import { Button, Field } from '@/design-system/primitives';

import type { SetupOverview } from '../contracts';
import { SETUP_COMMANDS, sendCommand } from './setup-api';
import { FormModal, NotEntered, Row, RowList, SetupSection, text } from './setup-ui';

export function ForecourtSection({ data, reload }: { data: SetupOverview; reload: () => void }) {
  const [dialog, setDialog] = useState<'pump' | 'nozzle' | null>(null);
  if (data.pumps === null || data.nozzles === null) return null;
  const products = data.products ?? [];
  const pumps = data.pumps;
  const nozzles = data.nozzles;
  const canManage = data.capabilities.forecourt;
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? 'Unknown product';
  const done = () => {
    setDialog(null);
    reload();
  };

  return (
    <SetupSection
      id="setup-forecourt"
      title="Pumps and nozzles"
      note="Each nozzle sells one product and has one meter. Meter readings are captured at the start of the first shift."
      action={
        canManage ? (
          <div className="state-actions">
            <Button variant="secondary" size="sm" onClick={() => setDialog('pump')}>
              Add pump
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDialog('nozzle')}
              disabled={pumps.length === 0 || products.length === 0}
            >
              Add nozzle
            </Button>
          </div>
        ) : undefined
      }
    >
      {pumps.length === 0 ? (
        <NotEntered what="pump" hint="No pump is entered, so no sales can be recorded." />
      ) : (
        <RowList label="Pumps and nozzles">
          {pumps.map((pump) => {
            const own = nozzles.filter((n) => n.pumpId === pump.id);
            return (
              <Row
                key={pump.id}
                title={`Pump ${pump.number}${pump.name ? ` · ${pump.name}` : ''}`}
                details={
                  own.length === 0
                    ? [{ label: 'Nozzles', value: 'Not entered' }]
                    : own.map((nozzle) => ({
                        label: `Nozzle ${nozzle.number}`,
                        value: `${productName(nozzle.productId)} · meter ${nozzle.meterSerialNumber ?? 'Not entered'}`,
                      }))
                }
              />
            );
          })}
        </RowList>
      )}

      <FormModal
        open={dialog === 'pump'}
        title="Add pump"
        submitLabel="Add pump"
        onClose={() => setDialog(null)}
        onDone={done}
        onSubmit={(form, key) =>
          sendCommand(
            SETUP_COMMANDS,
            {
              commandType: 'CreatePump',
              tenantId: data.tenantId,
              stationId: data.stationId,
              number: text(form, 'number'),
              ...(text(form, 'name') ? { name: text(form, 'name') } : {}),
            },
            key,
          )
        }
      >
        <Field id="pump-number" label="Pump number" required>
          <input id="pump-number" name="number" maxLength={16} autoComplete="off" />
        </Field>
        <Field id="pump-name" label="Name, optional">
          <input id="pump-name" name="name" maxLength={80} autoComplete="off" />
        </Field>
      </FormModal>

      <FormModal
        open={dialog === 'nozzle'}
        title="Add nozzle"
        description="The meter is recorded with the nozzle. Use the serial number printed on the meter."
        submitLabel="Add nozzle"
        onClose={() => setDialog(null)}
        onDone={done}
        onSubmit={(form, key) =>
          sendCommand(
            SETUP_COMMANDS,
            {
              commandType: 'CreateNozzle',
              tenantId: data.tenantId,
              stationId: data.stationId,
              pumpId: text(form, 'pump'),
              number: text(form, 'number'),
              productId: text(form, 'product'),
              meterSerialNumber: text(form, 'meter'),
            },
            key,
          )
        }
      >
        <Field id="nozzle-pump" label="Pump" required>
          <Select
            id="nozzle-pump"
            name="pump"
            defaultValue=""
            placeholder="Choose a pump"
            options={pumps
              .filter((p) => p.status === 'ACTIVE')
              .map((p) => ({ value: p.id, label: `Pump ${p.number}` }))}
          />
        </Field>
        <Field id="nozzle-number" label="Nozzle number" required>
          <input id="nozzle-number" name="number" maxLength={16} autoComplete="off" />
        </Field>
        <Field id="nozzle-product" label="Product" required>
          <Select
            id="nozzle-product"
            name="product"
            defaultValue=""
            placeholder="Choose a product"
            options={products
              .filter((p) => p.status === 'ACTIVE')
              .map((p) => ({ value: p.id, label: p.name }))}
          />
        </Field>
        <Field id="nozzle-meter" label="Meter serial number" required>
          <input id="nozzle-meter" name="meter" maxLength={80} autoComplete="off" />
        </Field>
      </FormModal>
    </SetupSection>
  );
}
