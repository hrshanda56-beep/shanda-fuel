import { ExactDecimal, DECIMAL_POLICIES } from '../../platform/domain/primitives';

export const OPENING_LINE_TYPES = [
  'SUPPLIER_INVOICE',
  'CUSTOMER_CHARGE',
  'CASH_BALANCE',
  'BANK_BALANCE',
  'TANK_STOCK',
] as const;
export type OpeningLineType = (typeof OPENING_LINE_TYPES)[number];

export const OPENING_BALANCE_STATES = ['DRAFT', 'APPROVED', 'LOCKED'] as const;
export type OpeningBalanceState = (typeof OPENING_BALANCE_STATES)[number];

export type OpeningCsvRow = Readonly<Record<string, string>>;

export type ParsedOpeningLine = Readonly<{
  lineNumber: number;
  lineKey: string;
  lineType: OpeningLineType;
  legalEntityReference: string | null;
  stationCode: string | null;
  supplierCode: string | null;
  customerReference: string | null;
  accountReference: string | null;
  cashLocationCode: string | null;
  bankAccountName: string | null;
  tankCode: string | null;
  reference: string | null;
  effectiveDate: string;
  dueDate: string | null;
  amount: string | null;
  quantityLitres: string | null;
  inventoryValue: string | null;
  currency: 'USD';
  notes: string | null;
  rawRow: OpeningCsvRow;
}>;

export type CsvIssue = Readonly<{
  lineNumber: number | null;
  field: string | null;
  message: string;
}>;

export type OpeningCsvParseResult = Readonly<{
  headers: readonly string[];
  rows: readonly ParsedOpeningLine[];
  issues: readonly CsvIssue[];
}>;

const HEADERS = [
  'line_key',
  'line_type',
  'legal_entity_reference',
  'station_code',
  'supplier_code',
  'customer_reference',
  'account_reference',
  'cash_location_code',
  'bank_account_name',
  'tank_code',
  'reference',
  'effective_date',
  'due_date',
  'amount',
  'quantity_litres',
  'inventory_value',
  'currency',
  'notes',
] as const;

export const OPENING_BALANCE_CSV_HEADERS = HEADERS;

function cell(value: string | undefined): string {
  return value?.trim() ?? '';
}

function nullable(value: string | undefined): string | null {
  const result = cell(value);
  return result === '' ? null : result;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function decimal(
  value: string | null,
  policy: typeof DECIMAL_POLICIES.money | typeof DECIMAL_POLICIES.litres,
  field: string,
  lineNumber: number,
  issues: CsvIssue[],
  options?: { positive?: boolean; nonNegative?: boolean },
): string | null {
  if (value === null) return null;
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    issues.push({ lineNumber, field, message: `${field} must be a non-negative decimal.` });
    return null;
  }
  const fraction = value.split('.')[1] ?? '';
  if (fraction.length > policy.scale) {
    issues.push({ lineNumber, field, message: `${field} has too many digits.` });
    return null;
  }
  try {
    const parsed = new ExactDecimal(value, policy);
    if (options?.positive && !parsed.value.gt(0)) {
      issues.push({ lineNumber, field, message: `${field} must be greater than zero.` });
      return null;
    }
    if (options?.nonNegative && parsed.value.isNegative()) {
      issues.push({ lineNumber, field, message: `${field} must not be negative.` });
      return null;
    }
    return parsed.quantize(policy).value.toFixed(policy.scale);
  } catch {
    issues.push({ lineNumber, field, message: `${field} has too many digits.` });
    return null;
  }
}

/** RFC-4180-compatible parser; it deliberately rejects malformed quoted rows. */
export function parseCsvRecords(csv: string): { records: string[][]; issues: CsvIssue[] } {
  const records: string[][] = [];
  const issues: CsvIssue[] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let quoteClosed = false;
  let lineNumber = 1;

  const finishField = () => {
    row.push(field);
    field = '';
    quoteClosed = false;
  };
  const finishRow = () => {
    finishField();
    records.push(row);
    row = [];
  };

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]!;
    if (quoted) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          quoteClosed = true;
        }
      } else {
        field += character;
        if (character === '\n') lineNumber += 1;
      }
      continue;
    }
    if (quoteClosed) {
      if (character === ',') finishField();
      else if (character === '\r') {
        if (csv[index + 1] === '\n') index += 1;
        finishRow();
        lineNumber += 1;
      } else if (character === '\n') {
        finishRow();
        lineNumber += 1;
      } else {
        issues.push({
          lineNumber,
          field: null,
          message: 'A quoted field must be followed by a comma or end of row.',
        });
        quoteClosed = false;
      }
      continue;
    }
    if (character === '"' && field === '') quoted = true;
    else if (character === ',') finishField();
    else if (character === '\r') {
      if (csv[index + 1] === '\n') index += 1;
      finishRow();
      lineNumber += 1;
    } else if (character === '\n') {
      finishRow();
      lineNumber += 1;
    } else field += character;
  }
  if (quoted)
    issues.push({ lineNumber, field: null, message: 'The CSV has an unterminated quoted field.' });
  else if (field !== '' || row.length > 0 || csv.endsWith(',')) finishRow();
  return { records, issues };
}

export function parseOpeningBalanceCsv(csv: string): OpeningCsvParseResult {
  if (csv.length === 0)
    return {
      headers: [],
      rows: [],
      issues: [{ lineNumber: null, field: null, message: 'The CSV file is empty.' }],
    };
  const parsed = parseCsvRecords(csv.replace(/^\uFEFF/, ''));
  const [headerRow, ...dataRows] = parsed.records;
  if (!headerRow || headerRow.length === 0) {
    return {
      headers: [],
      rows: [],
      issues: [
        ...parsed.issues,
        { lineNumber: 1, field: null, message: 'The CSV header row is missing.' },
      ],
    };
  }
  const headers = headerRow.map((header) => header.trim().toLowerCase());
  const issues = [...parsed.issues];
  const missing = HEADERS.filter((header) => !headers.includes(header));
  const unexpected = headers.filter(
    (header) => !HEADERS.includes(header as (typeof HEADERS)[number]),
  );
  if (missing.length)
    issues.push({
      lineNumber: 1,
      field: null,
      message: `Missing CSV columns: ${missing.join(', ')}.`,
    });
  if (unexpected.length)
    issues.push({
      lineNumber: 1,
      field: null,
      message: `Unknown CSV columns: ${unexpected.join(', ')}.`,
    });
  if (new Set(headers).size !== headers.length)
    issues.push({ lineNumber: 1, field: null, message: 'CSV columns must not be duplicated.' });
  if (issues.length) return { headers, rows: [], issues };

  const rows: ParsedOpeningLine[] = [];
  const keys = new Set<string>();
  dataRows.forEach((record, index) => {
    const lineNumber = index + 2;
    if (record.every((value) => value.trim() === '')) return;
    const rawRow: Record<string, string> = {};
    headers.forEach((header, headerIndex) => {
      rawRow[header] = record[headerIndex] ?? '';
    });
    const lineKey = cell(rawRow.line_key);
    const lineType = cell(rawRow.line_type) as OpeningLineType;
    const effectiveDate = cell(rawRow.effective_date);
    const dueDate = nullable(rawRow.due_date);
    if (!lineKey) issues.push({ lineNumber, field: 'line_key', message: 'line_key is required.' });
    else if (keys.has(lineKey))
      issues.push({
        lineNumber,
        field: 'line_key',
        message: `line_key '${lineKey}' is duplicated.`,
      });
    else keys.add(lineKey);
    if (!OPENING_LINE_TYPES.includes(lineType))
      issues.push({ lineNumber, field: 'line_type', message: 'line_type is not supported.' });
    if (!validDate(effectiveDate))
      issues.push({
        lineNumber,
        field: 'effective_date',
        message: 'effective_date must be a real YYYY-MM-DD date.',
      });
    if (dueDate && !validDate(dueDate))
      issues.push({
        lineNumber,
        field: 'due_date',
        message: 'due_date must be a real YYYY-MM-DD date.',
      });
    if (dueDate && validDate(effectiveDate) && dueDate < effectiveDate)
      issues.push({
        lineNumber,
        field: 'due_date',
        message: 'due_date cannot be before effective_date.',
      });
    const currency = cell(rawRow.currency).toUpperCase();
    if (currency !== 'USD')
      issues.push({
        lineNumber,
        field: 'currency',
        message: 'Only USD is supported for go-live opening balances.',
      });
    const amount = decimal(
      nullable(rawRow.amount),
      DECIMAL_POLICIES.money,
      'amount',
      lineNumber,
      issues,
      { nonNegative: true },
    );
    const quantityLitres = decimal(
      nullable(rawRow.quantity_litres),
      DECIMAL_POLICIES.litres,
      'quantity_litres',
      lineNumber,
      issues,
      { positive: true },
    );
    const inventoryValue = decimal(
      nullable(rawRow.inventory_value),
      DECIMAL_POLICIES.money,
      'inventory_value',
      lineNumber,
      issues,
      { positive: true },
    );
    const required = (field: string, value: string | null, message: string) => {
      if (!value) issues.push({ lineNumber, field, message });
    };
    if (lineType === 'SUPPLIER_INVOICE') {
      required(
        'legal_entity_reference',
        nullable(rawRow.legal_entity_reference),
        'Supplier invoices require a company.',
      );
      required(
        'supplier_code',
        nullable(rawRow.supplier_code),
        'Supplier invoices require a supplier code.',
      );
      required(
        'reference',
        nullable(rawRow.reference),
        'Supplier invoices require an invoice reference.',
      );
      if (!amount || new ExactDecimal(amount).value.eq(0))
        issues.push({
          lineNumber,
          field: 'amount',
          message: 'Supplier invoices require a positive amount.',
        });
    } else if (lineType === 'CUSTOMER_CHARGE') {
      required(
        'account_reference',
        nullable(rawRow.account_reference),
        'Customer charges require an account reference.',
      );
      required(
        'reference',
        nullable(rawRow.reference),
        'Customer charges require a source reference.',
      );
      if (!amount || new ExactDecimal(amount).value.eq(0))
        issues.push({
          lineNumber,
          field: 'amount',
          message: 'Customer charges require a positive amount.',
        });
    } else if (lineType === 'CASH_BALANCE') {
      required(
        'station_code',
        nullable(rawRow.station_code),
        'Cash balances require a station code.',
      );
      required(
        'cash_location_code',
        nullable(rawRow.cash_location_code),
        'Cash balances require a cash location code.',
      );
      if (!amount || new ExactDecimal(amount).value.eq(0))
        issues.push({
          lineNumber,
          field: 'amount',
          message: 'Cash balances require a positive amount.',
        });
    } else if (lineType === 'BANK_BALANCE') {
      required(
        'legal_entity_reference',
        nullable(rawRow.legal_entity_reference),
        'Bank balances require a company.',
      );
      required(
        'bank_account_name',
        nullable(rawRow.bank_account_name),
        'Bank balances require a bank account name.',
      );
      if (amount === null)
        issues.push({
          lineNumber,
          field: 'amount',
          message: 'Bank balances require an amount, including 0.0000.',
        });
    } else if (lineType === 'TANK_STOCK') {
      required(
        'station_code',
        nullable(rawRow.station_code),
        'Tank stock requires a station code.',
      );
      required('tank_code', nullable(rawRow.tank_code), 'Tank stock requires a tank code.');
      if (!quantityLitres)
        issues.push({
          lineNumber,
          field: 'quantity_litres',
          message: 'Tank stock requires positive litres.',
        });
    }
    rows.push({
      lineNumber,
      lineKey,
      lineType,
      legalEntityReference: nullable(rawRow.legal_entity_reference),
      stationCode: nullable(rawRow.station_code),
      supplierCode: nullable(rawRow.supplier_code),
      customerReference: nullable(rawRow.customer_reference),
      accountReference: nullable(rawRow.account_reference),
      cashLocationCode: nullable(rawRow.cash_location_code),
      bankAccountName: nullable(rawRow.bank_account_name),
      tankCode: nullable(rawRow.tank_code),
      reference: nullable(rawRow.reference),
      effectiveDate,
      dueDate,
      amount,
      quantityLitres,
      inventoryValue,
      currency: 'USD',
      notes: nullable(rawRow.notes),
      rawRow,
    });
  });
  return { headers, rows, issues };
}
