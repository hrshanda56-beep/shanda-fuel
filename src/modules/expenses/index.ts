/** Public expense module boundary. Server-only persistence stays behind the command/query entry points. */
export {
  EXPENSE_COMMAND_POLICY,
  EXPENSE_COMMAND_TYPES,
  EXPENSE_PERMISSION_CODES,
  type ExpenseCommandType,
} from './contracts';
export {
  EXPENSE_CATEGORY_CLASSIFICATIONS,
  EXPENSE_STATES,
  SETTLEMENT_SOURCES,
  type ExpenseCategoryClassification,
  type ExpenseState,
  type PaymentStatus,
  type SettlementSource,
} from './domain';
