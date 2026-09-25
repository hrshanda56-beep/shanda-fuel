export type DraftSaveCommand = Readonly<{
  commandType: string;
  values: Record<string, unknown>;
}>;

export type DraftSaveJournal = {
  saveAttemptId: string;
  commands: DraftSaveCommand[];
  nextIndex: number;
  version: number;
};

export function createDraftSaveAttemptId(): string {
  return crypto.randomUUID();
}

export function draftSaveCommandKey(input: {
  reconciliationId: string;
  saveAttemptId: string;
  commandIndex: number;
  commandType: string;
}): string {
  return `ui-draft-save-${input.reconciliationId}-${input.saveAttemptId}-${input.commandIndex}-${input.commandType}`;
}
