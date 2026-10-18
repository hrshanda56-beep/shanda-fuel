export function formatStaffInvitationMessage(
  invitation: { staffNumber: string; activationCode: string; expiresAt: string },
  origin: string,
): string {
  const expiry = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(invitation.expiresAt));
  return [
    'Your Shanda Fuel account invitation',
    '',
    `Staff number (your login username): ${invitation.staffNumber}`,
    `Activation code: ${invitation.activationCode}`,
    `Expires: ${expiry} UTC`,
    '',
    `Activate your account: ${new URL('/join', origin).href}`,
    'Enter your staff number and activation code, then choose your own password.',
    'After activation, sign in with your staff number and password.',
    '',
    'This code works once. After 5 incorrect attempts it is disabled; ask your manager for a new code if needed.',
    'Keep this invitation private. Never share your password.',
  ].join('\n');
}
