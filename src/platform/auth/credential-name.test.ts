import { expect, it } from 'vitest';
import { clerkCredentialName } from './credential-name';
it('sends full staff names as first and last name without inventing missing names', () => {
  expect(clerkCredentialName('  New   User ')).toEqual({ firstName: 'New', lastName: 'User' });
  expect(clerkCredentialName('Mary Jane Smith')).toEqual({
    firstName: 'Mary Jane',
    lastName: 'Smith',
  });
  expect(clerkCredentialName('Name')).toEqual({ firstName: 'Name' });
  expect(clerkCredentialName('Mary Jane', 'Smith')).toEqual({
    firstName: 'Mary Jane',
    lastName: 'Smith',
  });
});
