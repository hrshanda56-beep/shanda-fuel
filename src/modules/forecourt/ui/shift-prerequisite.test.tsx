import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ShiftPrerequisite } from './operations-control-room';

const html = (props: Parameters<typeof ShiftPrerequisite>[0]) =>
  renderToStaticMarkup(<ShiftPrerequisite {...props} />);

describe('opening a shift: why it is not possible yet', () => {
  it('tells a manager to open the business day first and links to readiness', () => {
    const out = html({ dayOpen: false, canOpenDay: true, canStartShift: true });
    expect(out).toContain('Open the business day');
    expect(out).toContain('/settings?tab=readiness');
  });

  it('tells someone without the right to ask a supervisor or owner', () => {
    expect(html({ dayOpen: false, canOpenDay: false, canStartShift: false })).toContain(
      'Ask the station supervisor or an owner to open it',
    );
    expect(html({ dayOpen: true, canOpenDay: true, canStartShift: false })).toContain(
      'not open one',
    );
  });

  it('says nothing when a shift can be opened', () => {
    expect(html({ dayOpen: true, canOpenDay: true, canStartShift: true })).toBe('');
  });
});
