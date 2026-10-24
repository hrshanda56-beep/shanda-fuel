/**
 * True when a refused export just needs the person to confirm their identity. The server words
 * this two ways: no recent strong sign-in at all, or no current step-up for this action.
 */
export function stepUpIsNeeded(status: number, message: string): boolean {
  return status === 403 && /strong authentication|step-up authentication/i.test(message);
}
