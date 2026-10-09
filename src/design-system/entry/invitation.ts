/**
 * Presentation contract for invitation links. The backend that issues,
 * validates and consumes invitations (single-use, expiring, revocable,
 * tenant/membership-bound, unable to alter the invited email, role or scope)
 * does not exist yet; this file is the seam it will fill.
 *
 * `organisationName` and `email` are display values only. The invitation's
 * role and scope are never sent to, or accepted from, the browser.
 */
export type InvitationView =
  | { kind: 'new-identity'; organisationName: string; email: string }
  | { kind: 'existing-identity'; organisationName: string }
  | { kind: 'unavailable' };

/**
 * Resolve an opaque invitation token to what the page may show. The token is
 * never rendered or logged. Until the invitation service ships there is nothing
 * to resolve against, so every link fails closed to the "unavailable" state,
 * which deliberately does not say whether the link was expired, revoked, used
 * or never valid.
 */
export async function resolveInvitationView(token: string): Promise<InvitationView> {
  void token;
  return { kind: 'unavailable' };
}
