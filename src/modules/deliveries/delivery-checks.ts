/**
 * The checks behind the "Record delivery" guide, one per question. Each returns errors keyed by
 * the id of the field to put the cursor on. Pure, so they are tested alone.
 */

export type Errors = Record<string, string>;

const AMOUNT = /^\d+(?:\.\d{1,3})?$/;

export function checkSupplier(supplierId: string): Errors {
  return supplierId ? {} : { 'rd-supplier': 'Choose the supplier who delivered the fuel.' };
}

export function checkTank(tankId: string): Errors {
  return tankId ? {} : { 'rd-tank': 'Choose the tank the fuel went into.' };
}

function checkAmount(id: string, value: string, what: string): Errors {
  const text = value.trim();
  if (!text) return { [id]: `Enter ${what}.` };
  if (!AMOUNT.test(text)) return { [id]: `Enter ${what} as a number, for example 5000 or 4980.5.` };
  return {};
}

/** The delivery note: its number, when the fuel arrived, and the quantity written on it. */
export function checkNote(noteNumber: string, deliveredAt: string, noteQuantity: string): Errors {
  const errors: Errors = {};
  if (!noteNumber.trim()) errors['rd-note-number'] = 'Enter the delivery note number.';
  if (!deliveredAt || Number.isNaN(new Date(deliveredAt).getTime())) {
    errors['rd-delivered-at'] = 'Enter when the fuel arrived.';
  }
  Object.assign(errors, checkAmount('rd-note-litres', noteQuantity, 'the quantity on the note'));
  return errors;
}

export function checkReceived(receivedQuantity: string): Errors {
  return checkAmount('rd-received-litres', receivedQuantity, 'the quantity you received');
}

/** Dips are optional, but when one is given it must be a number. */
export function checkDips(before: string, after: string): Errors {
  const errors: Errors = {};
  if (before.trim()) Object.assign(errors, checkAmount('rd-dip-before', before, 'the dip before'));
  if (after.trim()) Object.assign(errors, checkAmount('rd-dip-after', after, 'the dip after'));
  return errors;
}

/** A water reading is optional, but when a result is chosen a reading must be a number. */
export function checkWater(result: string, readingMm: string): Errors {
  if (!result || !readingMm.trim()) return {};
  return checkAmount('rd-water-mm', readingMm, 'the water found in millimetres');
}
