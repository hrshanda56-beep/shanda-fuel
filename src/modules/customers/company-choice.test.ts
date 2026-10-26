import { describe, expect, it } from 'vitest';

import { companyForNewCustomer } from './company-choice';

const two = [{ id: 'a' }, { id: 'b' }];

describe('companyForNewCustomer', () => {
  it('uses the company chosen at the top of the page', () => {
    expect(companyForNewCustomer({ selected: 'b', companies: two, picked: '' })).toEqual({
      legalEntityId: 'b',
      mustAskFirst: false,
    });
  });

  it('uses the only company without asking, on All stations', () => {
    expect(companyForNewCustomer({ selected: null, companies: [{ id: 'a' }], picked: '' })).toEqual(
      {
        legalEntityId: 'a',
        mustAskFirst: false,
      },
    );
  });

  it('asks first when there are several companies and none is chosen', () => {
    expect(companyForNewCustomer({ selected: null, companies: two, picked: '' })).toEqual({
      legalEntityId: null,
      mustAskFirst: true,
    });
    expect(companyForNewCustomer({ selected: null, companies: two, picked: 'a' })).toEqual({
      legalEntityId: 'a',
      mustAskFirst: false,
    });
  });

  it('does not ask when there is no company to choose from', () => {
    expect(companyForNewCustomer({ selected: null, companies: [], picked: '' })).toEqual({
      legalEntityId: null,
      mustAskFirst: false,
    });
  });
});
