export type ReconciliationEvidenceForGates = Readonly<{
  attendantsCount: number;
  salesVariance: string;
  cashVariance: string | null;
  stockVariance: Readonly<Record<string, string>>;
  requiresApproverNote: boolean;
  explanations: Readonly<Record<string, string>>;
}>;

function isZeroDecimal(value: string): boolean {
  return /^-?0+(?:\.0+)?$/.test(value.trim());
}

/** Mirrors the server's evidence requirements as a proactive UI guard. The server remains authoritative. */
export function missingReconciliationEvidence(input: ReconciliationEvidenceForGates): string[] {
  const missing: string[] = [];
  if (input.attendantsCount === 0) missing.push('at least one attendant');
  if (!isZeroDecimal(input.salesVariance) && !input.explanations.SALES?.trim()) {
    missing.push('sales variance explanation');
  }
  if (
    input.cashVariance !== null &&
    !isZeroDecimal(input.cashVariance) &&
    !input.explanations.CASH?.trim()
  ) {
    missing.push('cash variance explanation');
  }
  if (
    Object.values(input.stockVariance).some((value) => !isZeroDecimal(value)) &&
    !input.explanations.STOCK?.trim()
  ) {
    missing.push('stock variance explanation');
  }
  if (input.requiresApproverNote && !input.explanations.APPROVER_NOTE?.trim()) {
    missing.push('approver note for the red variance');
  }
  return missing;
}
