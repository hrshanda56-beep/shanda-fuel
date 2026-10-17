export type SerializedMoney = Readonly<{
  amount: string;
  currency: string;
}>;

export type SerializedCustomerStatementEntry = Readonly<{
  id: string;
  accountType: 'CREDIT' | 'PREPAID_VALUE' | 'PREPAID_LITRES';
  entryType: string;
  direction: 'INCREASE' | 'DECREASE';
  occurredAt: string;
  businessDate: string;
  amount?: SerializedMoney;
  quantityLitres?: string;
  note?: string;
}>;

export type SerializedCustomerStatementBalance =
  | Readonly<{
      accountType: 'CREDIT' | 'PREPAID_VALUE';
      currency: string;
      amount: string;
    }>
  | Readonly<{
      accountType: 'PREPAID_LITRES';
      currency: string;
      productBalances: readonly Readonly<{ productId: string; litres: string }>[];
    }>;

export type SerializedCustomerStatement = Readonly<{
  accountId: string;
  balance: SerializedCustomerStatementBalance;
  lines: readonly Readonly<{
    entry: SerializedCustomerStatementEntry;
    runningBalance: SerializedCustomerStatementBalance;
  }>[];
  asOf?: string;
  nextCursor?: string;
}>;

export function customerStatementUrl(input: {
  tenantId: string;
  accountId: string;
  asOf?: string;
  cursor?: string;
}): string {
  const params = new URLSearchParams({ tenantId: input.tenantId, accountId: input.accountId });
  if (input.asOf) params.set('asOf', input.asOf);
  if (input.cursor) params.set('cursor', input.cursor);
  return `/api/customers/statement?${params.toString()}`;
}

/** Convert the browser's local datetime control into the API's instant contract. */
export function localDateTimeToInstant(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function instantToLocalDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
