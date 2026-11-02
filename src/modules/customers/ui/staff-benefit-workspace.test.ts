import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@clerk/nextjs', () => ({ useReverification: () => vi.fn() }));

import { StaffBenefitWorkspace } from './staff-benefit-workspace';

const base = { tenantId: 'tenant', rows: [], customers: [], canOpenAccount: true } as const;

describe('Staff fuel benefit form', () => {
  it('picks staff from the staff list instead of asking for a typed name', () => {
    const html = renderToStaticMarkup(
      createElement(StaffBenefitWorkspace, {
        ...base,
        staff: [{ membershipId: 'm1', name: 'Tendai Moyo', email: 'tendai@example.com' }],
      }),
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('Search staff by name');
    expect(html).toContain('New people are added in Settings');
    expect(html).not.toContain('placeholder="Full name"');
    expect(html).not.toContain('Existing staff record');
  });

  it('says there is nobody to add when every staff member already has a benefit', () => {
    const html = renderToStaticMarkup(createElement(StaffBenefitWorkspace, { ...base, staff: [] }));
    expect(html).toContain('No staff to add');
    expect(html).toMatch(/<input[^>]*role="combobox"[^>]*disabled/);
  });
});
