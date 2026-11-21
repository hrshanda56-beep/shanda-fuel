'use client';

import { useState, type ReactNode } from 'react';

import { PageContainer } from '@/design-system/layout';
import {
  CreditLimitWizard,
  EntryDetailsWizard,
} from '../../../modules/customers/ui/account-controls-wizards';
import { EditCompanyGuide, EditStationGuide } from '../../../modules/settings/ui/structure-forms';
import { StaffAccessWizard } from '../../../modules/settings/ui/staff-access-wizard';
import { BankBalanceWizard } from '../../../modules/setup/ui/bank-balance-wizard';
import { StaffBenefitWizard } from '../../../modules/customers/ui/staff-benefit-wizard';
import {
  ApprovalLimitsWizard,
  CategoryWizard,
} from '../../../modules/expenses/ui/expense-setup-wizards';
import { PolicyWizard } from '../../../modules/purchasing/ui/policy-wizard';

const stations = [
  { id: 's1', name: 'Main', code: 'MAIN' },
  { id: 's2', name: 'North', code: 'NTH' },
];

const roleLabels = {
  OWNER: 'Owner',
  ADMINISTRATOR: 'Administrator',
  AUDITOR: 'Auditor',
  FINANCE: 'Finance',
  SUPERVISOR: 'Supervisor',
  ATTENDANT: 'Attendant',
  AREA_MANAGER: 'Area manager',
  CASH_COLLECTOR: 'Cash collector',
} as const;

const policy = {
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
} as const;

/** Hosts one guide and prints what it would save. */
export function PanelWizardsPreviewClient({ which }: { which: string }) {
  const [saved, setSaved] = useState<unknown>(null);
  const [categories, setCategories] = useState([
    { categoryId: 'k1', name: 'Repairs', note: 'Fixed cost: no' },
  ]);
  const common = { busy: false, error: null, onCancel: () => setSaved('cancelled') };
  const save = (value: unknown) => setSaved(value);

  let guide: ReactNode = <p>Pick a guide with ?w=</p>;
  if (which === 'bank-balance') {
    guide = (
      <BankBalanceWizard {...common} accountName="Operating" stations={stations} onSubmit={save} />
    );
  } else if (which === 'bank-balance-one') {
    guide = (
      <BankBalanceWizard
        {...common}
        accountName="Operating"
        stations={stations.slice(0, 1)}
        onSubmit={save}
      />
    );
  } else if (which === 'staff-benefit') {
    guide = (
      <StaffBenefitWizard
        {...common}
        staff={[
          { membershipId: 'm1', name: 'Tendai Moyo', email: 'tendai@example.com' },
          { membershipId: 'm2', name: 'Rudo Chikwanha', email: 'rudo@example.com' },
        ]}
        onSubmit={save}
      />
    );
  } else if (which === 'staff-access') {
    guide = (
      <StaffAccessWizard
        {...common}
        error={undefined}
        name="Tendai"
        roleLabels={roleLabels}
        overview={{
          canInviteOwner: false,
          scopeOptions: [
            { id: 'c1', name: 'Main Oils', stations },
            { id: 'c2', name: 'Other Oils', stations: [{ id: 's3', name: 'East', code: 'EST' }] },
          ],
        }}
        initial={{
          role: 'ATTENDANT',
          scopeType: 'STATION',
          legalEntityId: 'c1',
          stationIds: ['s1'],
        }}
        onSubmit={save}
      />
    );
  } else if (which === 'categories') {
    guide = (
      <CategoryWizard
        {...common}
        onClose={() => setSaved('closed')}
        categories={categories}
        onSubmit={(value) => {
          setCategories((current) => [
            ...current,
            { categoryId: `k${current.length + 1}`, name: value.name, note: '' },
          ]);
          setSaved(value);
        }}
      />
    );
  } else if (which === 'limits') {
    guide = (
      <ApprovalLimitsWizard
        {...common}
        current={{ stepUp: '', second: '1000', supervisor: '100' }}
        onSubmit={save}
      />
    );
  } else if (which === 'policy-company' || which === 'policy-supplier' || which === 'policy-view') {
    guide = (
      <PolicyWizard
        {...common}
        initial={policy}
        isCompany={which !== 'policy-supplier'}
        who={which === 'policy-supplier' ? 'Acme Fuels' : 'the whole company'}
        readOnly={which === 'policy-view'}
        onSubmit={(form, reason) => setSaved({ form, reason })}
      />
    );
  } else if (which === 'edit-company') {
    guide = (
      <EditCompanyGuide
        busy={false}
        error={null}
        company={{ id: 'c1', name: 'Main Oils' }}
        onCancel={() => setSaved('cancelled')}
        onSave={save}
      />
    );
  } else if (which === 'edit-station') {
    guide = (
      <EditStationGuide
        busy={false}
        error={null}
        station={{ id: 's1', code: 'MAIN', name: 'Main', timezone: 'Africa/Harare' }}
        onCancel={() => setSaved('cancelled')}
        onSave={save}
      />
    );
  } else if (which === 'credit-limit') {
    guide = (
      <CreditLimitWizard
        {...common}
        customerName="Moyo Transport"
        currentLimit="1000"
        currency="USD"
        approvers={[{ membershipId: 'm1', name: 'Rudo Chikwanha' }]}
        onSubmit={save}
      />
    );
  } else if (which === 'entry-details') {
    guide = (
      <EntryDetailsWizard
        {...common}
        stations={stations.slice(0, 1)}
        initialStationId=""
        approvers={[{ membershipId: 'm1', name: 'Rudo Chikwanha' }]}
        onSubmit={save}
      />
    );
  }

  return (
    <main>
      <PageContainer width="wide">
        <h1>Guides</h1>
        {guide}
        <pre data-testid="saved">{saved === null ? '' : JSON.stringify(saved)}</pre>
      </PageContainer>
    </main>
  );
}
