# Attendant guide and quick reference

Applies to B and C, subject to actual assigned scope. Read [access rules](README.md).

## Pocket quick reference

- Sign in with your own account. Select your station and open **My Shift** (`/my-shift`).
- Check station, shift, **Pump / Nozzle** and fuel before recording anything.
- Follow **What to do next** and **Needs attention**. Use **Record reading** only for the displayed opening or closing task.
- Read the physical meter carefully. Enter the complete value and check it before saving. Wait for the saved message and refreshed reading.
- If no station, shift, meter or capture permission is available, tell your supervisor. Do not use another person's account.
- If a reading is lower, unavailable, already saved incorrectly or belongs to a different pump, stop and ask the supervisor.
- At handover, give the supervisor actual readings, payment evidence and any exceptions. Sign out when finished.

## What you can do

The ATTENDANT template contains station/shift/meter viewing and `meter.boundary.capture`, plus context selection. The page also checks whether capture is currently allowed. It shows an assigned shift context and meters supplied by the server; do not treat every visible nozzle as proof that you personally own it. Confirm the roster and nozzle responsibility with the supervisor.

**My Shift** records opening/closing boundaries through `ConfirmBoundary`. It is not a reconciliation submission, payment declaration, expense approval, price-change or cash-banking screen. Do not promise those capabilities to attendants.

Opening and closing readings must correspond to the actual physical event. An opening reading does not itself start a shift. A closing reading does not itself seal every sales segment, approve reconciliation or close the business day. The supervisor manages the remaining authorized steps.

## Safe handover

Confirm the nozzle and meter value with the receiving person under the station's approved handover procedure. Pass on receipts and unresolved issues; use only the supported authorized application steps available to your account. The backend has a handover command, but a complete attendant self-service handover UI is not established here. Ask the supervisor to arrange it rather than editing identity or responsibility fields yourself.

For a lost connection, keep the current screen open where possible. Recheck persisted readings once connection returns. The page retries the same unchanged reading with the same attempt identifiers while mounted. A reload may lose that in-memory attempt; do not repeatedly submit if the result is uncertain. [Troubleshooting](troubleshooting.md) explains escalation. Even if an error says nothing was recorded, a lost response can leave an uncertain server outcome.
