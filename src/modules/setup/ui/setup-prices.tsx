'use client';

import { useState } from 'react';

import { Select } from '@/design-system/forms';
import { Button, Field, StatusBadge, type StatusTone } from '@/design-system/primitives';

import type { SetupOverview, SetupPrice } from '../contracts';
import {
  FORECOURT_COMMANDS,
  SETUP_COMMANDS,
  friendlyMessage,
  sendCommand,
  trimDecimal,
  type CommandResult,
} from './setup-api';
import styles from './setup.module.css';
import { FormModal, NotEntered, Row, RowList, SetupSection, text } from './setup-ui';

const STATE_LABEL: Record<string, { label: string; tone: StatusTone }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PENDING_APPROVAL: { label: 'Waiting for approval', tone: 'pending' },
  APPROVED: { label: 'Approved', tone: 'informational' },
  SCHEDULED: { label: 'Scheduled', tone: 'informational' },
  PENDING_STATION_ACTIVATION: { label: 'Waiting for meter readings', tone: 'pending' },
  BOUNDARIES_IN_PROGRESS: { label: 'Taking meter readings', tone: 'pending' },
  ACTIVE: { label: 'In use', tone: 'positive' },
  FAILED_ACTIVATION: { label: 'Activation failed', tone: 'critical' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

function toIso(local: string): string {
  return new Date(local).toISOString();
}

export function PricesSection({ data, reload }: { data: SetupOverview; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  if (data.prices === null) return null;
  const products = (data.products ?? []).filter((p) => p.status === 'ACTIVE');
  const prices = data.prices;
  const caps = data.capabilities;
  const nameOf = (id: string) => data.products?.find((p) => p.id === id)?.name ?? 'Unknown product';
  const sold = new Set(
    (data.nozzles ?? []).filter((n) => n.status === 'ACTIVE').map((n) => n.productId),
  );
  const productsToShow = products.filter(
    (p) => sold.has(p.id) || prices.some((x) => x.productId === p.id),
  );
  const activeFor = (id: string) => prices.find((p) => p.productId === id && p.state === 'ACTIVE');
  const pending = prices.filter((p) => p.state !== 'ACTIVE' && p.state !== 'CANCELLED');

  async function step(price: SetupPrice, kind: 'submit' | 'approve' | 'activate') {
    setBusyId(price.id);
    setError(undefined);
    const common = { tenantId: data.tenantId, stationId: data.stationId, priceId: price.id };
    const key = crypto.randomUUID();
    const result: CommandResult =
      kind === 'submit'
        ? await sendCommand(
            FORECOURT_COMMANDS,
            { ...common, commandType: 'RequestPriceChange', expectedVersion: price.version },
            key,
          )
        : kind === 'approve'
          ? await sendCommand(
              FORECOURT_COMMANDS,
              { ...common, commandType: 'ApprovePriceChange', expectedVersion: price.version },
              key,
            )
          : await sendCommand(
              SETUP_COMMANDS,
              { ...common, commandType: 'ActivateInitialPrice', expectedVersion: price.version },
              key,
            );
    setBusyId(undefined);
    if (result.ok) reload();
    else setError(result.message || friendlyMessage(result.status));
  }

  return (
    <SetupSection
      id="setup-prices"
      title="Selling prices"
      note="Pump prices per product. A product cannot be sold or reconciled until its price is in use."
      action={
        caps.priceRequest ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setOpen(true)}
            disabled={products.length === 0}
          >
            Set a price
          </Button>
        ) : undefined
      }
    >
      {products.length === 0 ? (
        <NotEntered what="price" hint="Add a fuel product before setting a price." />
      ) : productsToShow.length === 0 ? (
        <NotEntered what="price" />
      ) : (
        <RowList label="Current selling prices">
          {productsToShow.map((product) => {
            const active = activeFor(product.id);
            return (
              <Row
                key={product.id}
                title={product.name}
                badge={
                  <StatusBadge tone={active ? 'positive' : 'warning'}>
                    {active ? 'In use' : 'Not entered'}
                  </StatusBadge>
                }
                details={[
                  {
                    label: 'Price',
                    value: active
                      ? `${trimDecimal(active.unitPrice)} ${active.currency} per litre`
                      : 'Not entered',
                  },
                ]}
              />
            );
          })}
        </RowList>
      )}

      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}

      {pending.length > 0 ? (
        <>
          <h4 className={styles.subtitle}>Price changes in progress</h4>
          <RowList label="Price changes in progress">
            {pending.map((price) => {
              const meta = STATE_LABEL[price.state] ?? {
                label: price.state,
                tone: 'neutral' as const,
              };
              const hasActive = Boolean(activeFor(price.productId));
              const action =
                price.state === 'DRAFT' && caps.priceRequest
                  ? { kind: 'submit' as const, label: 'Submit for approval' }
                  : price.state === 'PENDING_APPROVAL' && caps.priceApprove
                    ? { kind: 'approve' as const, label: 'Approve' }
                    : price.state === 'APPROVED' && caps.priceActivate && !hasActive
                      ? { kind: 'activate' as const, label: 'Start using this price' }
                      : null;
              return (
                <Row
                  key={price.id}
                  title={`${nameOf(price.productId)} · ${trimDecimal(price.unitPrice)} ${price.currency}`}
                  badge={<StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>}
                  details={[
                    {
                      label: 'Effective from',
                      value: new Date(price.effectiveFrom).toLocaleString(),
                    },
                    ...(price.state === 'APPROVED' && hasActive
                      ? [
                          {
                            label: 'Next step',
                            value:
                              'Changing a price that is already in use needs meter readings at the pumps. This is not available here yet.',
                          },
                        ]
                      : []),
                  ]}
                  actions={
                    action ? (
                      <Button
                        size="sm"
                        loading={busyId === price.id}
                        disabled={busyId !== undefined}
                        onClick={() => void step(price, action.kind)}
                      >
                        {action.label}
                      </Button>
                    ) : undefined
                  }
                />
              );
            })}
          </RowList>
        </>
      ) : null}

      <FormModal
        open={open}
        title="Set a price"
        description="The price must be approved by a second person before it can be used."
        submitLabel="Submit for approval"
        onClose={() => setOpen(false)}
        onDone={() => {
          setOpen(false);
          reload();
        }}
        onSubmit={async (form, key) => {
          const drafted = await sendCommand<{ priceId?: string }>(
            SETUP_COMMANDS,
            {
              commandType: 'DraftPriceChange',
              tenantId: data.tenantId,
              stationId: data.stationId,
              productId: text(form, 'product'),
              unitPrice: text(form, 'price'),
              currency: text(form, 'currency'),
              effectiveFrom: toIso(text(form, 'effective')),
            },
            key,
          );
          if (!drafted.ok || !drafted.data.priceId) return drafted;
          const submitted = await sendCommand(
            FORECOURT_COMMANDS,
            {
              commandType: 'RequestPriceChange',
              tenantId: data.tenantId,
              stationId: data.stationId,
              priceId: drafted.data.priceId,
              expectedVersion: 0,
            },
            `${key}:submit`,
          );
          // The draft is saved even if submitting failed; it then shows under
          // "Price changes in progress" with its own Submit button.
          if (!submitted.ok) {
            reload();
            return {
              ok: false,
              status: submitted.status,
              message: `The price was saved as a draft but could not be submitted: ${submitted.message} Close this form and use Submit for approval.`,
            };
          }
          return submitted;
        }}
      >
        <Field id="price-product" label="Product" required>
          <Select
            id="price-product"
            name="product"
            defaultValue=""
            placeholder="Choose a product"
            options={products.map((p) => ({ value: p.id, label: p.name }))}
          />
        </Field>
        <Field id="price-amount" label="Price per litre" required>
          <input
            id="price-amount"
            name="price"
            inputMode="decimal"
            pattern={String.raw`\d+(\.\d{1,6})?`}
            autoComplete="off"
          />
        </Field>
        <Field
          id="price-currency"
          label="Currency code"
          hint="Three letters, for example USD."
          required
        >
          <input
            id="price-currency"
            name="currency"
            maxLength={3}
            pattern="[A-Za-z]{3}"
            autoComplete="off"
          />
        </Field>
        <Field
          id="price-effective"
          label="Effective from"
          hint="In your device's local time."
          required
        >
          <input id="price-effective" name="effective" type="datetime-local" />
        </Field>
      </FormModal>
    </SetupSection>
  );
}
