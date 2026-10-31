export function mapA12OperatorError(
  code: string | undefined,
  message: string | undefined,
): string | null {
  if (message?.includes('UNVALUED')) {
    return 'Stock valuation is blocking this. Open Inventory → Valuation, add the missing cost for the stock shown there, then try again.';
  }
  if (message?.includes('already has a revaluation workflow')) {
    return 'This stock is already being revalued. Open its valuation history and refresh before trying again.';
  }
  if (message?.includes('Only a requested')) {
    return 'This revaluation changed before approval. Refresh the valuation history to review the current status.';
  }
  if (message?.includes('Only an approved')) {
    return 'This revaluation is not ready to post. Refresh the valuation history and confirm that approval is recorded.';
  }
  if (code === 'IDEMPOTENCY_CONFLICT') {
    return 'This action key was already used with different data. Refresh the workflow before retrying.';
  }
  return null;
}
