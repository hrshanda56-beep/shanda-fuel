# Owner guide

Applies to B, with C instructions explicitly marked. First read [release and access rules](README.md).

## One-page Owner quick start

1. Open Shanda Fuel, sign in with your own account and complete the MFA prompt.
2. Use **Switch station**. Confirm organisation, legal entity, station and business date.
3. Open the home dashboard (`/`). Check the period and available operational facts. Empty or unavailable figures do not mean no sales or no problems.
4. Open **Daily Operations** (`/operations/daily`). Review the selected day and shifts. Use **View statement** for reconciliation evidence where available.
5. Compare meter sales, declared payments, cash count, expenses and stock evidence. Read every non-zero variance explanation. Payment evidence is not proof of bank receipt.
6. Open the submitted reconciliation's management review through its application link. Confirm station, shift, submitter and figures. Use [secure approval](procedures.md) only with the required permission and a different authorized approver.
7. **C only:** complete **Verify identity for approval**, then review **Approve these figures?** and confirm **Approve**. Identity verification alone does not approve the record.
8. Reopen the record and confirm its saved status. Review Reports, Cash and Settlements for outstanding follow-up. Sign out.

If access, data or approval is unavailable, record the problem and escalate. Do not substitute invented figures, share an account or bypass approval.

## Dashboard and management review

The dashboard is intended to answer how operations are performing today and what needs attention. Use the facts actually loaded for your authorized scope. The full intended headline set is not a guarantee that every metric exists on B. C changes the home overview and operational guidance; inspect it after release before teaching its exact layout.

Daily Operations brings together team, meters, payments, expenses, counted cash, inventory evidence and reconciliation. The operator/submitter and the accountable approving Supervisor must be distinguishable. The current `SUPERVISOR` role template submits; Owner, Administrator and Finance templates include approval. Your job title alone does not grant it. See [permission limits](verification.md).

On B, review uses **Return reason**, **Return for correction** and **Approve production reconciliation**. B has no equivalent integrated approval-specific identity dialog in this workspace. If strong authentication is required and cannot be completed through the available supported UI, stop and escalate; do not use developer tools or an API workaround. C supplies the approval-specific dialog and final confirmation.

Return incomplete submitted evidence with a clear reason. C calls this **Send back**, with **Return reason** and a **Send back for correction?** confirmation. Approval locks ordinary editing and posts canonical sale evidence. It is not a bank confirmation or a declaration that every financial obligation is settled. Never approve your own submission.

## Reports and missing information

Open `/reports` and select the report and scope/period provided. B labels include **Income Statement**, **Cash Movement**, **Sales & Payments**, **Cash Evidence to Bank**, **Electronic Evidence & Settlements**, **Suppliers & Customers**, and **Tanks, Deliveries & Variance**. C revises some report wording; use the displayed catalog after release.

Check missing-cost, missing-stock, missing-provider and other incompleteness messages before relying on a total. Do not describe incomplete information as profit, banked cash or final settlement. Customers and statements support review of balances/activity where authorized; a statement does not create a payment or alter a balance. Follow the Finance guide for evidence follow-up.

Before first-station use, approve the real station setup, opening evidence, responsible staff and escalation contacts in the [onboarding workbook](../onboarding/README.md). Missing onboarding data cannot be repaired by a trainer inventing readings, prices, balances or staff assignments.
