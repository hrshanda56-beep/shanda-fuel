import { expect, it } from 'vitest';
import { formatStaffInvitationMessage } from './staff-invitation-message';
it('copies labeled credentials, unambiguous expiry and employee instructions', () => {
  const message = formatStaffInvitationMessage(
    { staffNumber: 'E12345', activationCode: '7K3M-9R2X', expiresAt: '2026-10-21T00:16:59Z' },
    'https://fuel.example.test',
  );
  expect(message).toContain('Staff number (your login username): E12345');
  expect(message).toContain('Activation code: 7K3M-9R2X');
  expect(message).toMatch(/Expires: 21 October 2026(?:,| at) 00:16 UTC/);
  expect(message).toContain('https://fuel.example.test/join');
  expect(message).toContain('choose your own password');
  expect(message).toContain('5 incorrect attempts');
});
