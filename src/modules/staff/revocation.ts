export function staffDeactivationResponseStatus(result: { sessionsRevoked: boolean }): number {
  return result.sessionsRevoked ? 200 : 503;
}
