'use client';

import { BottomSheet, Button, DialogFrame } from '../primitives';

/**
 * Keep the trigger buttons inside this client boundary. The foundation page is
 * a Server Component, and passing a client Button element as DialogFrame's
 * trigger crosses the React Flight boundary before DialogFrame clones it.
 */
export function FoundationModalShowcase() {
  return (
    <>
      <DialogFrame
        trigger={<Button variant="secondary">Open accessible dialog</Button>}
        title="Confirm return"
        description="This is a synthetic modal surface for future named commands."
      >
        <p>Focus is contained here until the dialog is closed.</p>
      </DialogFrame>
      <BottomSheet
        trigger={<Button variant="quiet">Open mobile sheet</Button>}
        title="Quick context"
        description="Short contextual tasks can use this responsive presentation."
      >
        <p>Longer workflows should remain full pages.</p>
      </BottomSheet>
    </>
  );
}
