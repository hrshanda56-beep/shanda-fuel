export type CloseMetersJournal = {
  commands: Array<{ body: Record<string, unknown>; key: string }>;
  confirmedCount?: number;
  uncertain?: boolean;
  readings: Array<{ nozzleId: string; opening: string; closing: string }>;
};

/** Replays the entire frozen attempt: the server owns idempotency and authorization. */
export async function replayCloseMeters(
  journal: CloseMetersJournal,
  post: (body: Record<string, unknown>, key: string) => Promise<void>,
) {
  for (const [index, command] of journal.commands.entries()) {
    try {
      await post(command.body, command.key);
      journal.confirmedCount = Math.max(journal.confirmedCount ?? 0, index + 1);
    } catch (error) {
      if (!(error as { definitiveRejection?: boolean } | null)?.definitiveRejection)
        journal.uncertain = true;
      throw error;
    }
  }
}
