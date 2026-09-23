'use client';

import { useMemo, useState } from 'react';
import { Button, Card, Field, NumericInput, StatusBadge } from '../../../design-system/primitives';
import {
  DECIMAL_POLICIES,
  ExactDecimal,
  businessDate,
  litres,
  money,
  unitPrice,
} from '../../../platform/domain/primitives';
import {
  approveDailyReconciliation,
  calculateDailyReconciliation,
  reviseReturnedDailyReconciliation,
  returnDailyReconciliation,
  submitDailyReconciliation,
  type DailyReconciliation,
  type DailyReconciliationPaymentMethod,
} from '../daily-reconciliation';
import type { MeterSegment } from '../domain';

type WorkflowRole = 'SUPERVISOR' | 'MANAGEMENT';

const ids = {
  tenant: '11111111-1111-4111-8111-111111111111',
  station: '22222222-2222-4222-8222-222222222222',
  day: '33333333-3333-4333-8333-333333333333',
  shift: '44444444-4444-4444-8444-444444444444',
  supervisor: '55555555-5555-4555-8555-555555555555',
  attendant: '66666666-6666-4666-8666-666666666666',
  diesel: '77777777-7777-4777-8777-777777777777',
  petrol: '88888888-8888-4888-8888-888888888888',
};

function segment(
  id: string,
  productId: string,
  productName: string,
  opening: string,
  closing: string,
  price: string,
): MeterSegment & { productName: string } {
  const sold = new ExactDecimal(closing)
    .subtract(new ExactDecimal(opening))
    .quantize(DECIMAL_POLICIES.litres);
  return {
    id,
    tenantId: ids.tenant,
    stationId: ids.station,
    nozzleId: `${id.slice(0, 8)}-0000-4000-8000-000000000001`,
    meterInstallationId: `${id.slice(0, 8)}-0000-4000-8000-000000000002`,
    meterId: `${id.slice(0, 8)}-0000-4000-8000-000000000003`,
    businessDayId: ids.day,
    shiftId: ids.shift,
    openingBoundaryId: `${id.slice(0, 8)}-0000-4000-8000-000000000004`,
    closingBoundaryId: `${id.slice(0, 8)}-0000-4000-8000-000000000005`,
    productId,
    attendantId: ids.attendant,
    enteredBy: ids.supervisor,
    openingReading: opening,
    closingReading: closing,
    litres: litres(sold.toString()),
    unitPrice: unitPrice(price),
    currency: 'USD',
    expectedSaleValue: money(
      sold.multiply(unitPrice(price)).quantize(DECIMAL_POLICIES.money).toString(),
    ),
    openingBoundaryReason: 'SHIFT_OPEN',
    boundaryReason: 'SHIFT_CLOSE',
    startAt: '2026-09-20T06:00:00.000Z',
    endAt: '2026-09-20T14:00:00.000Z',
    sealedAt: '2026-09-20T14:00:01.000Z',
    controlledException: false,
    version: 1,
    productName,
  };
}

function litresBetween(opening: string, closing: string): string {
  try {
    return new ExactDecimal(closing)
      .subtract(new ExactDecimal(opening))
      .quantize(DECIMAL_POLICIES.litres)
      .toString();
  } catch {
    return '—';
  }
}

function initialReconciliation(): DailyReconciliation {
  const diesel = segment(
    '99999999-9999-4999-8999-999999999999',
    ids.diesel,
    'Arcturus Diesel',
    '1000.000',
    '1010.000',
    '1.500000',
  );
  const petrol = segment(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ids.petrol,
    'TEI Oils Petrol',
    '800.000',
    '808.000',
    '1.700000',
  );
  return calculateDailyReconciliation({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    revision: 1,
    tenantId: ids.tenant,
    stationId: ids.station,
    businessDayId: ids.day,
    shiftId: ids.shift,
    operationalDate: businessDate('2026-09-20'),
    supervisorId: ids.supervisor,
    attendantIds: [ids.attendant],
    segments: [diesel, petrol],
    payments: [
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        method: 'CASH',
        amount: money('12.00'),
        note: 'Till count',
      },
      {
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        method: 'POS',
        amount: money('16.60'),
        reference: 'POS-20260920-01',
      },
    ],
    expenses: [
      {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        category: 'Station supplies',
        description: 'Cleaning materials',
        amount: money('1.25'),
        paymentMethod: 'CASH',
        personPaid: 'Station attendant',
      },
    ],
    deliveries: [],
    tankDips: [
      {
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        tankId: 'tank-diesel-0000-4000-8000-000000000001',
        productId: ids.diesel,
        openingLitres: litres('100.000'),
        closingLitres: litres('90.000'),
      },
      {
        id: '12121212-1212-4212-8212-121212121212',
        tankId: 'tank-petrol-0000-4000-8000-000000000001',
        productId: ids.petrol,
        openingLitres: litres('80.000'),
        closingLitres: litres('72.000'),
      },
    ],
    cash: { countedCash: money('10.75') },
  });
}

function statusTone(state: DailyReconciliation['state']) {
  return state === 'APPROVED'
    ? 'locked'
    : state === 'RETURNED'
      ? 'warning'
      : state === 'SUBMITTED'
        ? 'pending'
        : 'informational';
}

export function DailyReconciliationWorkflow({ role = 'SUPERVISOR' }: { role?: WorkflowRole }) {
  const [reconciliation, setReconciliation] = useState(initialReconciliation);
  const [explanation, setExplanation] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [closingDiesel, setClosingDiesel] = useState('1010.000');
  const [closingPetrol, setClosingPetrol] = useState('808.000');
  const [cashCounted, setCashCounted] = useState('10.75');

  const editable = reconciliation.state === 'DRAFT' || reconciliation.state === 'RETURNED';
  const recalculated = useMemo(() => {
    if (!editable) return reconciliation;
    try {
      const base = initialReconciliation();
      const diesel = segment(
        base.id,
        ids.diesel,
        'Arcturus Diesel',
        '1000.000',
        closingDiesel,
        '1.500000',
      );
      const petrol = segment(
        `${base.id.slice(0, 8)}-0000-4000-8000-000000000006`,
        ids.petrol,
        'TEI Oils Petrol',
        '800.000',
        closingPetrol,
        '1.700000',
      );
      return calculateDailyReconciliation({
        ...base,
        segments: [diesel, petrol],
        cash: { countedCash: money(cashCounted || '0') },
      });
    } catch {
      return reconciliation;
    }
  }, [cashCounted, closingDiesel, closingPetrol, editable, reconciliation]);

  function saveDraft() {
    setReconciliation(recalculated);
    setSaved(true);
    setError(undefined);
  }

  function submit() {
    try {
      setReconciliation(submitDailyReconciliation(recalculated, ids.supervisor, explanation));
      setSaved(false);
      setError(undefined);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'The reconciliation could not be submitted',
      );
    }
  }

  function approve() {
    try {
      setReconciliation(
        approveDailyReconciliation(reconciliation, 'management-member', new Date().toISOString()),
      );
      setError(undefined);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'The reconciliation could not be approved',
      );
    }
  }

  function returnForCorrection() {
    try {
      setReconciliation(returnDailyReconciliation(reconciliation, returnReason));
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'A return reason is required');
    }
  }

  return (
    <div className="reconciliation-workflow" aria-label="Daily forecourt reconciliation workflow">
      <div className="page-header">
        <div>
          <p className="eyebrow">Daily forecourt reconciliation</p>
          <h1>TEI Oils · 20 Sep 2026 · Morning shift</h1>
          <p className="lede">
            Meter readings are sealed server records. This form captures declarations and evidence
            around them.
          </p>
        </div>
        <StatusBadge tone={statusTone(reconciliation.state)}>{reconciliation.state}</StatusBadge>
      </div>

      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="state state-success" role="status">
          Draft saved. No financial posting has occurred.
        </p>
      ) : null}

      <div className="content-grid">
        <Card as="section" className="panel" aria-labelledby="header-title">
          <p className="eyebrow">1 · Shift and team</p>
          <h2 id="header-title">Station context</h2>
          <dl className="operational-summary">
            <div>
              <dt>Station</dt>
              <dd>TEI Oils service station</dd>
            </div>
            <div>
              <dt>Operational date</dt>
              <dd>20 Sep 2026</dd>
            </div>
            <div>
              <dt>Shift</dt>
              <dd>Morning shift · 06:00–14:00</dd>
            </div>
            <div>
              <dt>Supervisor</dt>
              <dd>Demo supervisor</dd>
            </div>
            <div>
              <dt>Attendants</dt>
              <dd>Arcturus team · 1 assigned</dd>
            </div>
          </dl>
        </Card>

        <Card as="section" className="panel" aria-labelledby="meter-title">
          <p className="eyebrow">2 · Pump and nozzle readings</p>
          <h2 id="meter-title">Server-derived sales</h2>
          <div className="responsive-table-wrap">
            <table className="responsive-table">
              <caption className="visually-hidden">Sealed pump and nozzle readings</caption>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Opening</th>
                  <th scope="col">Closing</th>
                  <th scope="col">Price/L</th>
                  <th scope="col">Litres</th>
                  <th scope="col">Sales</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td data-label="Product">Arcturus Diesel · Pump 1 / N1</td>
                  <td data-label="Opening" className="numeric">
                    1,000.000
                  </td>
                  <td data-label="Closing">
                    <NumericInput
                      id="diesel-closing"
                      label="Diesel closing reading"
                      aria-label="Diesel closing reading"
                      value={closingDiesel}
                      onChange={(event) => setClosingDiesel(event.target.value)}
                      unit="L"
                    />
                  </td>
                  <td data-label="Price/L" className="numeric">
                    1.500000
                  </td>
                  <td data-label="Litres" className="numeric">
                    {litresBetween('1000.000', closingDiesel)}
                  </td>
                  <td data-label="Sales" className="numeric">
                    {litresBetween('1000.000', closingDiesel) === '—'
                      ? '—'
                      : new ExactDecimal(litresBetween('1000.000', closingDiesel))
                          .multiply(new ExactDecimal('1.5'))
                          .quantize(DECIMAL_POLICIES.money)
                          .toString()}{' '}
                    USD
                  </td>
                </tr>
                <tr>
                  <td data-label="Product">TEI Oils Petrol · Pump 1 / N2</td>
                  <td data-label="Opening" className="numeric">
                    800.000
                  </td>
                  <td data-label="Closing">
                    <NumericInput
                      id="petrol-closing"
                      label="Petrol closing reading"
                      aria-label="Petrol closing reading"
                      value={closingPetrol}
                      onChange={(event) => setClosingPetrol(event.target.value)}
                      unit="L"
                    />
                  </td>
                  <td data-label="Price/L" className="numeric">
                    1.700000
                  </td>
                  <td data-label="Litres" className="numeric">
                    {litresBetween('800.000', closingPetrol)}
                  </td>
                  <td data-label="Sales" className="numeric">
                    {litresBetween('800.000', closingPetrol) === '—'
                      ? '—'
                      : new ExactDecimal(litresBetween('800.000', closingPetrol))
                          .multiply(new ExactDecimal('1.7'))
                          .quantize(DECIMAL_POLICIES.money)
                          .toString()}{' '}
                    USD
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="field-hint">
            Closing readings below opening readings are rejected. Historical meter values cannot be
            silently overwritten.
          </p>
        </Card>

        <Card as="section" className="panel" aria-labelledby="payments-title">
          <p className="eyebrow">3 · Payments and expenses</p>
          <h2 id="payments-title">Accounted sales</h2>
          <div className="metric-grid">
            <div className="metric-card">
              <span className="metric-label">Expected sales</span>
              <strong className="metric-value numeric">
                {recalculated.totals.expectedSales.amount.toString()} USD
              </strong>
            </div>
            <div className="metric-card">
              <span className="metric-label">Accounted</span>
              <strong className="metric-value numeric">
                {recalculated.totals.accountedSales.amount.toString()} USD
              </strong>
            </div>
            <div className="metric-card">
              <span className="metric-label">Sales variance</span>
              <strong className="metric-value numeric">
                {recalculated.totals.salesVariance.amount.toString()} USD
              </strong>
            </div>
          </div>
          <div className="responsive-table-wrap">
            <table className="responsive-table">
              <caption className="visually-hidden">Payment allocations</caption>
              <thead>
                <tr>
                  <th scope="col">Method</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Evidence</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td data-label="Method">CASH</td>
                  <td data-label="Amount" className="numeric">
                    12.00 USD
                  </td>
                  <td data-label="Evidence">Till count</td>
                </tr>
                <tr>
                  <td data-label="Method">POS</td>
                  <td data-label="Amount" className="numeric">
                    16.60 USD
                  </td>
                  <td data-label="Evidence">POS-20260920-01</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="field-hint">
            Supported channels include Cash, POS, EcoCash, bank transfer, customer credit, prepaid,
            approved staff/management fuel, and other approved.
          </p>
        </Card>

        <Card as="section" className="panel" aria-labelledby="stock-title">
          <p className="eyebrow">4 · Deliveries and tank dips</p>
          <h2 id="stock-title">Stock accountability</h2>
          <p>
            Tank dips use an approved opening position + deliveries − meter litres sold ±
            adjustments. No calibration or stock movement is invented here.
          </p>
          <div className="responsive-table-wrap">
            <table className="responsive-table">
              <caption className="visually-hidden">Tank closing dips</caption>
              <thead>
                <tr>
                  <th scope="col">Tank</th>
                  <th scope="col">Product</th>
                  <th scope="col">Opening</th>
                  <th scope="col">Closing</th>
                  <th scope="col">Gap</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td data-label="Tank">Tank D1</td>
                  <td data-label="Product">Arcturus Diesel</td>
                  <td data-label="Opening" className="numeric">
                    100.000 L
                  </td>
                  <td data-label="Closing" className="numeric">
                    90.000 L
                  </td>
                  <td data-label="Gap" className="numeric">
                    0.000 L
                  </td>
                </tr>
                <tr>
                  <td data-label="Tank">Tank P1</td>
                  <td data-label="Product">TEI Oils Petrol</td>
                  <td data-label="Opening" className="numeric">
                    80.000 L
                  </td>
                  <td data-label="Closing" className="numeric">
                    72.000 L
                  </td>
                  <td data-label="Gap" className="numeric">
                    0.000 L
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card as="section" className="panel" aria-labelledby="cash-title">
          <p className="eyebrow">5 · Cash and explanation</p>
          <h2 id="cash-title">Counted cash</h2>
          <Field
            id="cash-counted"
            label="Cash counted"
            hint="Cash-paid expenses reduce expected physical cash."
            required
          >
            <input
              id="cash-counted"
              value={cashCounted}
              onChange={(event) => setCashCounted(event.target.value)}
              inputMode="decimal"
            />
          </Field>
          <p className="field-hint">
            Expected cash:{' '}
            <strong className="numeric">
              {recalculated.totals.expectedPhysicalCash.amount.toString()} USD
            </strong>{' '}
            · Variance:{' '}
            <strong className="numeric">
              {recalculated.totals.cashVariance?.amount.toString() ?? 'not counted'} USD
            </strong>
          </p>
          <Field
            id="variance-explanation"
            label="Supervisor explanation"
            hint="Required for sales, cash, or stock variances."
          >
            <textarea
              id="variance-explanation"
              rows={3}
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
              disabled={!editable}
              placeholder="Explain any difference or confirm the evidence used"
            />
          </Field>
        </Card>
      </div>

      <Card as="section" className="panel" aria-labelledby="review-title">
        <p className="eyebrow">6 · Review and control</p>
        <h2 id="review-title">Ready for {role === 'MANAGEMENT' ? 'management' : 'submission'}</h2>
        <ul className="review-checklist">
          <li>
            {recalculated.issues.length === 0
              ? 'All meter, payment, cash, and tank checks pass'
              : `${recalculated.issues.length} item(s) need attention`}
          </li>
          <li>Expected sales are derived from sealed meter segments</li>
          <li>Approved records are locked; corrections use a new revision</li>
        </ul>
        <div className="form-actions">
          {editable ? (
            <Button variant="secondary" onClick={saveDraft}>
              Save draft
            </Button>
          ) : null}
          {role === 'SUPERVISOR' && editable ? (
            <Button variant="primary" onClick={submit}>
              Submit for management review
            </Button>
          ) : null}
          {role === 'SUPERVISOR' && reconciliation.state === 'RETURNED' ? (
            <Button
              variant="quiet"
              onClick={() => setReconciliation(reviseReturnedDailyReconciliation(reconciliation))}
            >
              Start correction
            </Button>
          ) : null}
          {role === 'MANAGEMENT' && reconciliation.state === 'SUBMITTED' ? (
            <>
              <Button variant="danger" onClick={returnForCorrection}>
                Return for correction
              </Button>
              <Button variant="primary" onClick={approve}>
                Approve and lock
              </Button>
            </>
          ) : null}
        </div>
        {role === 'MANAGEMENT' && reconciliation.state === 'SUBMITTED' ? (
          <Field
            id="return-reason"
            label="Return reason"
            hint="Required when returning this exact revision."
          >
            <textarea
              id="return-reason"
              rows={2}
              value={returnReason}
              onChange={(event) => setReturnReason(event.target.value)}
              placeholder="Describe the correction required"
            />
          </Field>
        ) : null}
        {reconciliation.state === 'APPROVED' ? (
          <p className="state state-success" role="status">
            Approved by management. This revision is locked; future corrections must be named
            adjustments or reversals.
          </p>
        ) : null}
      </Card>
    </div>
  );
}

export const paymentMethodLabels: Readonly<Record<DailyReconciliationPaymentMethod, string>> = {
  CASH: 'Cash',
  POS: 'POS',
  ECOCASH: 'EcoCash',
  BANK_TRANSFER: 'Bank transfer',
  CUSTOMER_CREDIT: 'Customer credit',
  PREPAID: 'Prepaid',
  STAFF_OR_MANAGEMENT_FUEL: 'Staff / management fuel',
  OTHER_APPROVED: 'Other approved',
};
