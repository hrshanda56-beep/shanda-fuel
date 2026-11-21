'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '@/design-system/modal';
import { PolicyWizard } from './policy-wizard';
import type { PolicyFormValues } from './policy-wizard-checks';
import { Icon } from '@/design-system/icons';
import { InfoTip } from '@/design-system/info-tip';
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
          <Card as="section" className="panel profit-panel" aria-labelledby="po-company-settings">
            <div className={styles.toolbar}>
              <span className="heading-with-tip">
                <h2 id="po-company-settings" className="profit-title">
                  For The Whole Company
                </h2>
                <InfoTip text="These settings decide how closely a supplier's invoice has to match what you ordered and received, and how VAT is treated. Set them once for the whole company, then give a supplier its own settings only if it needs different rules." />
              </span>
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
            <dl className={styles.settingsList}>
              {[
                [
                  'Invoice quantity vs quantity received',
                  litresAllowanceSentence(r.quantityToleranceLitres, r.quantityTolerancePercent),
                ],
                [
                  'Quantity received vs delivery note',
                  litresAllowanceSentence(
                    r.overReceiptToleranceLitres,
                    r.overReceiptTolerancePercent,
                  ),
                ],
                [
                  'Invoice price vs agreed price',
                  percentAllowanceSentence(r.priceTolerancePercent),
                ],
                ['Invoice total vs expected', amountAllowanceSentence(r.amountTolerance)],
                ['When a difference is too big', toleranceActionText(r.toleranceAction)],
                ['VAT', vatModeText(r.vatMode, r.defaultVatRate)],
                [
                  'Invoice lines',
                  r.requireInvoiceLines
                    ? 'Each invoice lists the fuel it is for'
                    : 'A single total is fine',
                ],
                [
                  'Transport bills',
                  r.requireTransportBill
                    ? 'Every delivery carried by another company needs its bill'
                    : 'A transport bill is optional',
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card as="section" className="panel profit-panel" aria-labelledby="po-supplier-settings">
            <span className="heading-with-tip">
              <h2 id="po-supplier-settings" className="profit-title">
                Suppliers With Different Rules
              </h2>
              <InfoTip text="Every supplier follows the company settings unless you give it its own." />
            </span>
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

type FormState = PolicyFormValues;

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
    requireTransportBill:
      view?.requireTransportBill === null || view?.requireTransportBill === undefined
        ? company
          ? 'false'
          : ''
        : String(view.requireTransportBill),
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

  function submit(values: FormState, reasonText: string) {
    setError(null);
    const numbers: Record<string, string | null> = {};
    for (const key of [
      'quantityToleranceLitres',
      'quantityTolerancePercent',
      'overReceiptToleranceLitres',
      'overReceiptTolerancePercent',
      'priceTolerancePercent',
      'amountTolerance',
      'defaultVatRate',
    ] as const) {
      // The guide has already checked each number; this only reads it.
      const checked = checkAllowanceInput(values[key], 4);
      numbers[key] = checked.ok ? checked.value : null;
    }
    const vatMode = values.vatMode || null;
    const existing = loadedView?.view ?? null;
    const body: Record<string, unknown> = {
      commandType: 'SetPurchasingPolicy',
      tenantId,
      legalEntityId,
      ...(supplierId ? { supplierId } : {}),
      ...(existing ? { expectedVersion: existing.version } : {}),
      reason: reasonText.trim(),
      ...numbers,
      defaultVatRate: vatMode === 'NONE' ? null : numbers.defaultVatRate,
      toleranceAction: values.toleranceAction || null,
      vatMode,
      requireInvoiceLines:
        values.requireInvoiceLines === '' ? null : values.requireInvoiceLines === 'true',
      requireTransportBill:
        values.requireTransportBill === '' ? null : values.requireTransportBill === 'true',
    };
    void save(body, false);
  }

  const ready = loadedView !== null;
  const companyView = company?.resolved;
  const companyNote =
    !isCompany && companyView
      ? `The company currently allows: ${litresAllowanceSentence(
          companyView.quantityToleranceLitres,
          companyView.quantityTolerancePercent,
        ).toLowerCase()} on invoice quantity, ${percentAllowanceSentence(
          companyView.priceTolerancePercent,
        ).toLowerCase()} on price.`
      : null;

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
            : 'Choose “Same as the company” to follow the company setting.'
        }
        presentation="page"
        backLabel="Purchase order settings"
        size="sm"
        dismissible={!busy}
      >
        {loadError ? <ErrorState message={loadError} /> : null}
        {!ready && !loadError ? <LoadingState label="Loading settings" /> : null}
        {ready ? (
          <PolicyWizard
            key={loadedView?.view?.version ?? 'new'}
            initial={form}
            isCompany={isCompany}
            who={isCompany ? 'the whole company' : scope.supplier.legalName}
            companyNote={companyNote}
            busy={busy}
            error={error}
            readOnly={!canManage}
            onCancel={onClose}
            onSubmit={submit}
          />
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
