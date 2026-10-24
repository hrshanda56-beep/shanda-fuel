'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Modal } from '@/design-system/modal';
import { Select } from '@/design-system/forms';
import { Icon } from '@/design-system/icons';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  StatusBadge,
  SuccessState,
} from '@/design-system/primitives';
import { StepUpDialog } from '@/modules/setup/ui/step-up-dialog';
import type { PurchasingCapabilities } from '../capabilities-types';
import {
  TOLERANCE_ACTION_OPTIONS,
  VAT_MODE_OPTIONS,
  amountAllowanceSentence,
  checkAllowanceInput,
  litresAllowanceSentence,
  percentAllowanceSentence,
  toleranceActionText,
  vatModeText,
} from './purchasing-format';
import { getJson, needsIdentityCheck, newKey, postJson } from './purchasing-client';
import type { PolicyData, PolicyView, SupplierName } from './purchasing-types';
import styles from './purchasing.module.css';

type Scope = { kind: 'company' } | { kind: 'supplier'; supplier: SupplierName };

export function SettingsPanel({
  tenantId,
  legalEntityId,
  suppliers,
  capabilities,
}: {
  tenantId: string;
  legalEntityId: string;
  suppliers: SupplierName[];
  capabilities: PurchasingCapabilities;
}) {
  const [data, setData] = useState<PolicyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Scope | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        setData(
          await getJson<PolicyData>(
            `/api/suppliers/policy?${new URLSearchParams({ tenantId, legalEntityId })}`,
            'The purchasing settings could not be loaded.',
            signal,
          ),
        );
      } catch (cause) {
        if (signal?.aborted) return;
        setError(
          cause instanceof Error ? cause.message : 'The purchasing settings could not be loaded.',
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [tenantId, legalEntityId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const r = data?.resolved;

  return (
    <div className={styles.stack}>
      <p className={styles.intro}>
        These settings decide how closely a supplier&apos;s invoice has to match what you ordered
        and received, and how VAT is treated. Set them once for the whole company, then give a
        supplier its own settings only if it needs different rules.
      </p>
      {notice ? <SuccessState title="Saved" message={notice} /> : null}
      {loading ? <LoadingState label="Loading settings" /> : null}
      {error ? (
        <ErrorState
          message={error}
          action={<Button onClick={() => void load()}>Try again</Button>}
        />
      ) : null}

      {data && r && !loading && !error ? (
        <>
          <Card as="section" className="panel" aria-labelledby="po-company-settings">
            <div className={styles.toolbar}>
              <h3 id="po-company-settings">For the whole company</h3>
              {capabilities.manageSettings ? (
                <Button
                  className={styles.toolbarEnd}
                  variant="secondary"
                  onClick={() => setEditing({ kind: 'company' })}
                >
                  {data.configured ? 'Change settings' : 'Set up'}
                </Button>
              ) : null}
            </div>
            {!data.configured ? (
              <p className={styles.muted}>
                Nothing has been set up yet, so any difference at all is flagged and no VAT is
                added. Choose Set up to say how much difference is acceptable.
              </p>
            ) : null}
            <div className={styles.settingsGrid}>
              <div className={styles.settingBlock}>
                <h4>Litres on the invoice compared with litres received</h4>
                <p>
                  {litresAllowanceSentence(r.quantityToleranceLitres, r.quantityTolerancePercent)}
                </p>
              </div>
              <div className={styles.settingBlock}>
                <h4>Litres received compared with the delivery note</h4>
                <p>
                  {litresAllowanceSentence(
                    r.overReceiptToleranceLitres,
                    r.overReceiptTolerancePercent,
                  )}
                </p>
              </div>
              <div className={styles.settingBlock}>
                <h4>Invoice price compared with the agreed price</h4>
                <p>{percentAllowanceSentence(r.priceTolerancePercent)}</p>
              </div>
              <div className={styles.settingBlock}>
                <h4>Invoice total compared with what we expect</h4>
                <p>{amountAllowanceSentence(r.amountTolerance)}</p>
              </div>
              <div className={styles.settingBlock}>
                <h4>If a difference is bigger than allowed</h4>
                <p>{toleranceActionText(r.toleranceAction)}</p>
              </div>
              <div className={styles.settingBlock}>
                <h4>VAT</h4>
                <p>{vatModeText(r.vatMode, r.defaultVatRate)}</p>
              </div>
              <div className={styles.settingBlock}>
                <h4>Invoice lines</h4>
                <p>
                  {r.requireInvoiceLines
                    ? 'Each invoice must list the fuel it is for'
                    : 'Invoices can be entered as a single total'}
                </p>
              </div>
            </div>
          </Card>

          <Card as="section" className="panel" aria-labelledby="po-supplier-settings">
            <h3 id="po-supplier-settings">Suppliers with different rules</h3>
            <p className={styles.muted}>
              Every supplier follows the company settings unless you give it its own.
            </p>
            {suppliers.length === 0 ? (
              <EmptyState
                title="No suppliers yet"
                message="Add a supplier on the Suppliers page first."
              />
            ) : (
              <div className={styles.table}>
                <ul className="list-rows" aria-label="Suppliers">
                  {suppliers.map((supplier) => {
                    const own = data.suppliersWithOverrides.includes(supplier.supplierId);
                    return (
                      <li key={supplier.supplierId}>
                        <button
                          type="button"
                          className={`${styles.row} list-row`}
                          style={{ gridTemplateColumns: 'minmax(0, 1fr) auto 2rem' }}
                          aria-label={`${capabilities.manageSettings ? 'Change' : 'See'} settings for ${supplier.legalName}`}
                          onClick={() => setEditing({ kind: 'supplier', supplier })}
                        >
                          <span className={`${styles.rowTitle} ${styles.cell}`}>
                            <strong>{supplier.legalName}</strong>
                            <small>
                              {own ? 'Has its own settings' : 'Follows the company settings'}
                            </small>
                          </span>
                          <span className={styles.cell}>
                            {own ? (
                              <StatusBadge tone="informational">Own settings</StatusBadge>
                            ) : null}
                          </span>
                          <span className={styles.chevron} aria-hidden="true">
                            <Icon name="chevron-right" />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Card>
        </>
      ) : null}

      {editing ? (
        <PolicyDialog
          key={editing.kind === 'company' ? 'company' : editing.supplier.supplierId}
          tenantId={tenantId}
          legalEntityId={legalEntityId}
          scope={editing}
          company={data}
          canManage={capabilities.manageSettings}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setNotice(message);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

type FormState = {
  quantityToleranceLitres: string;
  quantityTolerancePercent: string;
  overReceiptToleranceLitres: string;
  overReceiptTolerancePercent: string;
  priceTolerancePercent: string;
  amountTolerance: string;
  toleranceAction: string;
  vatMode: string;
  defaultVatRate: string;
  requireInvoiceLines: string;
};

function trimNumber(value: string | null): string {
  if (value === null) return '';
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

function formFromPolicy(view: PolicyView | null, company: boolean): FormState {
  return {
    quantityToleranceLitres: trimNumber(view?.quantityToleranceLitres ?? null),
    quantityTolerancePercent: trimNumber(view?.quantityTolerancePercent ?? null),
    overReceiptToleranceLitres: trimNumber(view?.overReceiptToleranceLitres ?? null),
    overReceiptTolerancePercent: trimNumber(view?.overReceiptTolerancePercent ?? null),
    priceTolerancePercent: trimNumber(view?.priceTolerancePercent ?? null),
    amountTolerance: trimNumber(view?.amountTolerance ?? null),
    toleranceAction: view?.toleranceAction ?? (company ? 'FLAG' : ''),
    vatMode: view?.vatMode ?? (company ? 'NONE' : ''),
    defaultVatRate: trimNumber(view?.defaultVatRate ?? null),
    requireInvoiceLines:
      view?.requireInvoiceLines === null || view?.requireInvoiceLines === undefined
        ? company
          ? 'true'
          : ''
        : String(view.requireInvoiceLines),
  };
}

function PolicyDialog({
  tenantId,
  legalEntityId,
  scope,
  company,
  canManage,
  onClose,
  onSaved,
}: {
  tenantId: string;
  legalEntityId: string;
  scope: Scope;
  company: PolicyData | null;
  canManage: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isCompany = scope.kind === 'company';
  const supplierId = scope.kind === 'supplier' ? scope.supplier.supplierId : null;
  const [loadedView, setLoadedView] = useState<{ view: PolicyView | null } | null>(
    isCompany ? { view: company?.tenantPolicy ?? null } : null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() =>
    formFromPolicy(isCompany ? (company?.tenantPolicy ?? null) : null, isCompany),
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stepUp, setStepUp] = useState<(() => void) | null>(null);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    if (isCompany || !supplierId) return;
    const controller = new AbortController();
    void getJson<PolicyData>(
      `/api/suppliers/policy?${new URLSearchParams({ tenantId, legalEntityId, supplierId })}`,
      'This supplier’s settings could not be loaded.',
      controller.signal,
    )
      .then((result) => {
        setLoadedView({ view: result.supplierOverride });
        setForm(formFromPolicy(result.supplierOverride, false));
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setLoadError(
          cause instanceof Error ? cause.message : 'This supplier’s settings could not be loaded.',
        );
      });
    return () => controller.abort();
  }, [isCompany, supplierId, tenantId, legalEntityId]);

  const set = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));
  const title = isCompany
    ? 'Purchasing settings for the whole company'
    : `Settings for ${scope.supplier.legalName}`;
  const follow = isCompany ? null : 'Same as the company';
  const stepUpOpen = stepUp !== null;

  async function save(body: Record<string, unknown>, confirmed: boolean) {
    const fingerprint = JSON.stringify(body);
    if (attempt.current?.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: newKey() };
    }
    setBusy(true);
    setError(null);
    try {
      await postJson(
        '/api/suppliers/commands',
        body,
        attempt.current.key,
        'The settings could not be saved.',
      );
      attempt.current = null;
      onSaved(
        isCompany
          ? 'The company purchasing settings were saved.'
          : `The settings for ${scope.kind === 'supplier' ? scope.supplier.legalName : ''} were saved.`,
      );
    } catch (cause) {
      if (!confirmed && needsIdentityCheck(cause)) {
        setStepUp(() => () => void save(body, true));
      } else {
        setError(cause instanceof Error ? cause.message : 'The settings could not be saved.');
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const fields: Array<[keyof FormState, string, number]> = [
      ['quantityToleranceLitres', 'Allowed litres difference on the invoice', 3],
      ['quantityTolerancePercent', 'Allowed percentage difference on the invoice litres', 4],
      ['overReceiptToleranceLitres', 'Allowed extra litres compared with the delivery note', 3],
      ['overReceiptTolerancePercent', 'Allowed extra percentage compared with the note', 4],
      ['priceTolerancePercent', 'Allowed price difference', 4],
      ['amountTolerance', 'Allowed invoice total difference', 4],
      ['defaultVatRate', 'VAT rate', 4],
    ];
    const values: Record<string, string | null> = {};
    for (const [key, label, places] of fields) {
      const checked = checkAllowanceInput(form[key], places);
      if (!checked.ok) {
        return setError(
          `${label}: enter a plain number (at most ${places} decimal places), or leave it empty.`,
        );
      }
      values[key] = checked.value;
    }
    const vatMode = form.vatMode || null;
    if (vatMode && vatMode !== 'NONE' && !values.defaultVatRate) {
      return setError('Enter the VAT rate that applies to supplier invoices.');
    }
    if (!reason.trim()) return setError('Say briefly why you are changing these settings.');
    const existing = loadedView?.view ?? null;
    const body: Record<string, unknown> = {
      commandType: 'SetPurchasingPolicy',
      tenantId,
      legalEntityId,
      ...(supplierId ? { supplierId } : {}),
      ...(existing ? { expectedVersion: existing.version } : {}),
      reason: reason.trim(),
      ...values,
      defaultVatRate: vatMode === 'NONE' ? null : values.defaultVatRate,
      toleranceAction: form.toleranceAction || null,
      vatMode,
      requireInvoiceLines:
        form.requireInvoiceLines === '' ? null : form.requireInvoiceLines === 'true',
    };
    void save(body, false);
  }

  const ready = loadedView !== null;
  const disabled = !canManage || busy;
  const companyView = company?.resolved;

  return (
    <>
      <Modal
        open={!stepUpOpen}
        onClose={() => {
          if (!busy) onClose();
        }}
        title={title}
        description={
          isCompany
            ? 'These apply to every supplier unless a supplier has its own settings.'
            : 'Leave a box empty or choose “Same as the company” to follow the company setting.'
        }
        size="lg"
        dismissible={!busy}
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              {canManage ? 'Cancel' : 'Close'}
            </Button>
            {canManage ? (
              <Button type="submit" form="purchasing-policy-form" loading={busy} disabled={!ready}>
                Save settings
              </Button>
            ) : null}
          </>
        }
      >
        {loadError ? <ErrorState message={loadError} /> : null}
        {!ready && !loadError ? <LoadingState label="Loading settings" /> : null}
        {error ? <ErrorState title="Please check the form" message={error} /> : null}
        {ready ? (
          <form id="purchasing-policy-form" className={styles.formGrid} onSubmit={submit}>
            {!canManage ? (
              <p className={styles.muted}>You can see these settings but not change them.</p>
            ) : null}
            <fieldset className={styles.fieldset} disabled={disabled}>
              <legend>How much difference is acceptable?</legend>
              <p className={styles.muted}>
                An invoice is only flagged when it is further off than this. Leave empty to allow no
                difference
                {isCompany ? '.' : ', or to follow the company setting.'}
              </p>
              <div className={styles.pair}>
                <Field
                  id="pp-qty-l"
                  label="Litres on the invoice vs litres received (litres)"
                  optional
                >
                  <input
                    id="pp-qty-l"
                    inputMode="decimal"
                    value={form.quantityToleranceLitres}
                    onChange={(e) => set({ quantityToleranceLitres: e.target.value })}
                  />
                </Field>
                <Field id="pp-qty-p" label="…or as a percentage (%)" optional>
                  <input
                    id="pp-qty-p"
                    inputMode="decimal"
                    value={form.quantityTolerancePercent}
                    onChange={(e) => set({ quantityTolerancePercent: e.target.value })}
                  />
                </Field>
                <Field
                  id="pp-over-l"
                  label="Extra litres received vs delivery note (litres)"
                  optional
                >
                  <input
                    id="pp-over-l"
                    inputMode="decimal"
                    value={form.overReceiptToleranceLitres}
                    onChange={(e) => set({ overReceiptToleranceLitres: e.target.value })}
                  />
                </Field>
                <Field id="pp-over-p" label="…or as a percentage (%)" optional>
                  <input
                    id="pp-over-p"
                    inputMode="decimal"
                    value={form.overReceiptTolerancePercent}
                    onChange={(e) => set({ overReceiptTolerancePercent: e.target.value })}
                  />
                </Field>
                <Field id="pp-price" label="Invoice price vs agreed price (%)" optional>
                  <input
                    id="pp-price"
                    inputMode="decimal"
                    value={form.priceTolerancePercent}
                    onChange={(e) => set({ priceTolerancePercent: e.target.value })}
                  />
                </Field>
                <Field id="pp-amount" label="Invoice total vs expected total (USD)" optional>
                  <input
                    id="pp-amount"
                    inputMode="decimal"
                    value={form.amountTolerance}
                    onChange={(e) => set({ amountTolerance: e.target.value })}
                  />
                </Field>
              </div>
              <Field id="pp-action" label="If a difference is bigger than allowed">
                <Select
                  id="pp-action"
                  value={form.toleranceAction}
                  onChange={(e) => set({ toleranceAction: e.target.value })}
                  options={[
                    ...(follow ? [{ value: '', label: follow }] : []),
                    ...TOLERANCE_ACTION_OPTIONS,
                  ]}
                />
              </Field>
            </fieldset>

            <fieldset className={styles.fieldset} disabled={disabled}>
              <legend>VAT on supplier invoices</legend>
              <Field id="pp-vat" label="How do suppliers show VAT?">
                <Select
                  id="pp-vat"
                  value={form.vatMode}
                  onChange={(e) => set({ vatMode: e.target.value })}
                  options={[...(follow ? [{ value: '', label: follow }] : []), ...VAT_MODE_OPTIONS]}
                />
              </Field>
              {form.vatMode && form.vatMode !== 'NONE' ? (
                <Field id="pp-vat-rate" label="VAT rate (%)" required>
                  <input
                    id="pp-vat-rate"
                    inputMode="decimal"
                    value={form.defaultVatRate}
                    onChange={(e) => set({ defaultVatRate: e.target.value })}
                  />
                </Field>
              ) : null}
              <Field id="pp-lines" label="Invoice lines">
                <Select
                  id="pp-lines"
                  value={form.requireInvoiceLines}
                  onChange={(e) => set({ requireInvoiceLines: e.target.value })}
                  options={[
                    ...(follow ? [{ value: '', label: follow }] : []),
                    { value: 'true', label: 'Each invoice must list the fuel it is for' },
                    { value: 'false', label: 'Invoices can be entered as a single total' },
                  ]}
                />
              </Field>
            </fieldset>

            {!isCompany && companyView ? (
              <p className={styles.muted}>
                The company currently allows:{' '}
                {litresAllowanceSentence(
                  companyView.quantityToleranceLitres,
                  companyView.quantityTolerancePercent,
                ).toLowerCase()}{' '}
                on invoice litres,{' '}
                {percentAllowanceSentence(companyView.priceTolerancePercent).toLowerCase()} on
                price.
              </p>
            ) : null}

            {canManage ? (
              <Field
                id="pp-reason"
                label="Why are you changing these settings?"
                required
                hint="This is kept in the record of changes."
              >
                <input
                  id="pp-reason"
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Agreed new terms with the supplier"
                  disabled={busy}
                />
              </Field>
            ) : null}
          </form>
        ) : null}
      </Modal>
      <StepUpDialog
        open={stepUpOpen}
        tenantId={tenantId}
        description="Changing purchasing settings needs a fresh identity check first. Nothing is saved until you confirm."
        confirmLabel="Confirm and save"
        cancelledMessage="The check was cancelled or did not pass. Nothing was saved."
        onVerified={() => {
          const retry = stepUp;
          setStepUp(null);
          retry?.();
        }}
        onCancel={() => {
          setStepUp(null);
          setError('The identity check was cancelled, so nothing was saved.');
        }}
      />
    </>
  );
}
