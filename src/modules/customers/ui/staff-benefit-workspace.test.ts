import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@clerk/nextjs', () => ({ useReverification: () => vi.fn() }));

import { StaffBenefitWizard } from './staff-benefit-wizard';
import { StaffBenefitWorkspace } from './staff-benefit-workspace';

const base = { tenantId: 'tenant', rows: [], customers: [], canOpenAccount: true } as const;
const wizardProps = { busy: false, error: null, onCancel: () => {}, onSubmit: () => {} } as const;

describe('Staff fuel benefit page', () => {
  it('offers one button, not a form, and no side panel', () => {
    const html = renderToStaticMarkup(createElement(StaffBenefitWorkspace, { ...base, staff: [] }));
    expect(html).toContain('Add a staff member');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('role="combobox"');
    expect(html).not.toContain('Monthly limit');
  });

  it('only a person who can open accounts sees the button', () => {
    const html = renderToStaticMarkup(
      createElement(StaffBenefitWorkspace, { ...base, canOpenAccount: false, staff: [] }),
    );
    expect(html).not.toContain('aria-haspopup="dialog"');
  });
});

describe('Staff fuel benefit guide', () => {
  it('first asks only which staff member, picked from the staff list', () => {
    const html = renderToStaticMarkup(
      createElement(StaffBenefitWizard, {
        ...wizardProps,
        staff: [{ membershipId: 'm1', name: 'Tendai Moyo', email: 'tendai@example.com' }],
      }),
    );
    expect(html).toContain('Which staff member?');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('Search staff by name');
    expect(html).toContain('New people are added in Settings');
    expect(html).not.toContain('placeholder="Full name"');
    expect(html).not.toContain('Monthly limit');
  });

  it('says there is nobody to add when every staff member already has a benefit', () => {
    const html = renderToStaticMarkup(
      createElement(StaffBenefitWizard, { ...wizardProps, staff: [] }),
    );
    expect(html).toContain('No staff to add');
    expect(html).toMatch(/<input[^>]*role="combobox"[^>]*disabled/);
  });
});
