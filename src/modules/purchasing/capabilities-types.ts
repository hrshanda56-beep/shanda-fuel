/** What this person may do on the Purchasing screens. The server still checks every command. */
export type PurchasingCapabilities = Readonly<{
  viewOrders: boolean;
  createOrders: boolean;
  approveOrders: boolean;
  cancelOrders: boolean;
  /** Not-invoiced and invoice-check views. */
  reviewInvoices: boolean;
  viewSettings: boolean;
  manageSettings: boolean;
}>;
