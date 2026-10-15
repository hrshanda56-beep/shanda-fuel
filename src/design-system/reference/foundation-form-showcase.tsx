'use client';

import { Button, Field, NumericInput } from '@/design-system/primitives';

/**
 * The form pattern for /foundation. A client component on purpose: Field adds
 * aria-describedby, aria-required and required to its control with
 * cloneElement, which only applies consistently when Field and its control are
 * composed on the client. Passed in from a Server Component, the server HTML
 * would omit those attributes and hydration would report a mismatch.
 */
export function FoundationFormShowcase() {
  return (
    <form className="demo-form">
      <Field id="note" label="Draft note" hint="This is local-only synthetic content." required>
        <input id="note" name="note" type="text" placeholder="Add a short note" />
      </Field>
      <Field id="reason" label="Reason" error="A reason is required before submission.">
        <textarea id="reason" name="reason" rows={3} placeholder="Explain the exception" />
      </Field>
      <NumericInput
        id="quantity"
        name="quantity"
        label="Quantity"
        hint="Use the unit shown; authoritative validation happens on the server."
        unit="L"
        placeholder="0.000"
        optional
      />
      <div className="form-actions">
        <Button type="button" variant="primary">
          Save draft
        </Button>
        <Button type="button" variant="quiet">
          Cancel
        </Button>
      </div>
    </form>
  );
}
