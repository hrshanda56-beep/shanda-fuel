import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@clerk/nextjs', () => ({ useReverification: () => vi.fn() }));

import {
  BankCashWizard,
  CollectCashWizard,
  ConfirmDepositWizard,
  ReceiveCashWizard,
} from './cash/ui/cash-sheet-wizards';
import { CreditLimitWizard, EntryDetailsWizard } from './customers/ui/account-controls-wizards';
import { ApprovalLimitsWizard, CategoryWizard } from './expenses/ui/expense-setup-wizards';
import { PolicyWizard } from './purchasing/ui/policy-wizard';
import type { PolicyFormValues } from './purchasing/ui/policy-wizard-checks';
import { MatchPaymentWizard } from './settlements/ui/match-wizard';
import { StaffAccessWizard } from './settings/ui/staff-access-wizard';
import { AlertSettingsWizard } from './setup/ui/alert-settings-wizard';
import { BankBalanceWizard } from './setup/ui/bank-balance-wizard';

/**
 * Each guide that replaced a side panel (#252) draws its first screen without a browser: the right
 * question, nothing else, and no sign of the old all-in-one form. The step-by-step behaviour is in
 * the pure `*-checks` tests and the browser specs.
 */

const common = { busy: false, error: null, onCancel: () => {}, onSubmit: () => {} } as const;
const money = (value: string) => `USD ${value}`;
const render = (component: ComponentType<never>, props: object) =>
  renderToStaticMarkup(createElement(component as ComponentType<object>, props));

const locations = [
  { value: 'l1', label: 'Station till' },
  { value: 'l2', label: 'Station safe' },
];

describe('guides that replaced side panels draw one question', () => {
  it('bank balance asks which station when there are several', () => {
    const html = render(BankBalanceWizard, {
      ...common,
      accountName: 'Operating',
      stations: [
        { id: 's1', name: 'Main', code: 'MAIN' },
        { id: 's2', name: 'North', code: 'NTH' },
      ],
    });
    expect(html).toContain('Which station is this for?');
    expect(html).not.toContain('Date on the statement');
  });

  it('bank balance skips the station question with one station', () => {
    const html = render(BankBalanceWizard, {
      ...common,
      accountName: 'Operating',
      stations: [{ id: 's1', name: 'Main', code: 'MAIN' }],
    });
    expect(html).toContain('What balance does the statement show for Operating?');
  });

  it('reminders start with the first setting and offer usual choices', () => {
    const html = render(AlertSettingsWizard, {
      ...common,
      current: { dueSoon: '7', posLag: '3', grace: '1', minimum: '0.01' },
    });
    expect(html).toContain('How early should we warn you about supplier invoices?');
    expect(html).toContain('7 days');
    expect(html).toContain('Another number');
    expect(html).not.toContain('Ignore cash shortages smaller than');
  });

  it('credit limit asks for the limit first', () => {
    const html = render(CreditLimitWizard, {
      ...common,
      customerName: 'Moyo Transport',
      currentLimit: '1000',
      currency: 'USD',
      approvers: [{ membershipId: 'm1', name: 'Rudo' }],
    });
    expect(html).toContain('credit limit be?');
    expect(html).not.toContain('Who approved this change?');
  });

  it('transaction details ask for the station, then each detail on its own', () => {
    const base = { ...common, approvers: [], stations: [{ id: 's1', name: 'Main', code: 'MAIN' }] };
    const two = { ...base, stations: [...base.stations, { id: 's2', name: 'North', code: 'NTH' }] };
    expect(render(EntryDetailsWizard, { ...two, initialStationId: '' })).toContain(
      'Which station was it at?',
    );
    const known = render(EntryDetailsWizard, { ...two, initialStationId: 's1' });
    expect(known).toContain('What was the vehicle registration?');
    expect(known).toContain('Skip');
  });

  it('purchasing settings are one rule per screen, and read-only shows a summary', () => {
    const initial: PolicyFormValues = {
      quantityToleranceLitres: '',
      quantityTolerancePercent: '',
      overReceiptToleranceLitres: '',
      overReceiptTolerancePercent: '',
      priceTolerancePercent: '',
      amountTolerance: '',
      toleranceAction: 'FLAG',
      vatMode: 'NONE',
      defaultVatRate: '',
      requireInvoiceLines: 'true',
      requireTransportBill: 'false',
    };
    const base = { ...common, initial, who: 'the whole company', readOnly: false };
    const company = render(PolicyWizard, { ...base, isCompany: true });
    expect(company).toContain('How much can the invoice quantity differ from what was received?');
    expect(company).toContain('No difference allowed');
    expect(company).not.toContain('Same as the company');
    const supplier = render(PolicyWizard, { ...base, isCompany: false, who: 'Acme' });
    expect(supplier).toContain('Same as the company');
    const view = render(PolicyWizard, { ...base, isCompany: true, readOnly: true });
    expect(view).toContain('You can see these settings but not change them.');
    expect(view).not.toContain('Save settings');
  });

  it('staff access starts with the role', () => {
    const overview = {
      canInviteOwner: false,
      scopeOptions: [
        { id: 'c1', name: 'Main Oils', stations: [{ id: 's1', name: 'Main', code: 'MAIN' }] },
      ],
    };
    const html = render(StaffAccessWizard, {
      ...common,
      name: 'Tendai',
      overview,
      roleLabels: { ATTENDANT: 'Attendant', OWNER: 'Owner' },
      initial: { role: 'ATTENDANT', scopeType: 'STATION', legalEntityId: 'c1', stationIds: ['s1'] },
      error: undefined,
    });
    expect(html).toContain('What will Tendai do?');
  });

  it('cash guides each open on their first question', () => {
    const shared = { ...common, money, locations };
    expect(
      render(CollectCashWizard, {
        ...shared,
        sources: [{ reconciliationId: 'r1', businessDate: '2026-11-20', availableCash: '100' }],
        paidOutNote: null,
      }),
    ).toContain('Which shift is the cash from?');
    expect(
      render(ReceiveCashWizard, {
        ...shared,
        collections: [{ collectionId: 'c1', collectionReference: 'COL-1', amount: '50' }],
      }),
    ).toContain('Which cash has arrived?');
    expect(
      render(BankCashWizard, {
        ...shared,
        accounts: [
          { value: 'a1', label: 'Operating' },
          { value: 'a2', label: 'Savings' },
        ],
        collections: [
          {
            collectionId: 'c1',
            collectionReference: 'COL-1',
            availableAtStation: '50',
            currentLocationId: 'l1',
          },
        ],
      }),
    ).toContain('Which bank account is it going into?');
    const confirm = {
      ...shared,
      today: '2026-11-21',
      deposits: [
        { depositId: 'd1', depositReference: 'DEP-1', amount: '100', bankAccountName: 'Operating' },
        { depositId: 'd2', depositReference: 'DEP-2', amount: '20', bankAccountName: 'Operating' },
      ],
    };
    expect(render(ConfirmDepositWizard, confirm)).toContain('Which deposit are you confirming?');
    // Coming from one deposit's own button, that question is skipped.
    expect(render(ConfirmDepositWizard, { ...confirm, initialDepositId: 'd1' })).toContain(
      'What amount does the bank show?',
    );
  });

  it('match a payment skips a question with only one choice', () => {
    const props = {
      ...common,
      settlementId: '',
      paymentId: '',
      amount: '',
      maxAmount: null,
      maxLabel: null,
      onPickPayout: () => {},
      onPickPayment: () => {},
      onAmount: () => {},
      onSubmit: () => {},
    };
    const many = render(MatchPaymentWizard, {
      ...props,
      payouts: [
        { value: 's1', label: 'One' },
        { value: 's2', label: 'Two' },
      ],
      payments: [
        { value: 'p1', label: 'A' },
        { value: 'p2', label: 'B' },
      ],
    });
    expect(many).toContain('Which provider payout?');
    const one = render(MatchPaymentWizard, {
      ...props,
      payouts: [{ value: 's1', label: 'One' }],
      payments: [{ value: 'p1', label: 'A' }],
    });
    expect(one).toContain('How much of it matches?');
  });

  it('expense categories show the list first, and limits start with the identity check', () => {
    const list = render(CategoryWizard, {
      busy: false,
      error: null,
      onClose: () => {},
      onSubmit: () => {},
      categories: [{ categoryId: 'k1', name: 'Repairs', note: '' }],
    });
    expect(list).toContain('Kinds of expense');
    expect(list).toContain('Repairs');
    expect(list).toContain('Add a kind of expense');
    const limits = render(ApprovalLimitsWizard, {
      ...common,
      current: { stepUp: '', second: '', supervisor: '' },
    });
    expect(limits).toContain('When should the approver confirm their identity again?');
    expect(limits).toContain('Always, whatever the amount');
  });
});
