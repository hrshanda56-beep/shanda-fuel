# Common errors and troubleshooting

Follow [SOP 12](procedures.md) for uncertain writes. Never send passwords, MFA codes, recovery material, invitation tokens or full credential-bearing URLs to support.

| What you see                                   | What to do                                                                                                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session ended / sign-in required               | Sign in with your own account, restore authorized context and inspect persisted state before retrying a write.                                             |
| No authorised work areas / no station          | Ask the administrator to check active membership and station scope. Do not change IDs manually.                                                            |
| No shift / no meters set up                    | Confirm station and roster; ask supervisor/setup owner to complete real onboarding. Do not create dummy records.                                           |
| Action disabled                                | Read the reason. Check state, prerequisites and assigned permissions with supervisor.                                                                      |
| 403 / not allowed                              | Check scope and permission. For privileged actions, check whether supported fresh verification is required. Not every 403 is MFA.                          |
| Verification failed                            | Check your own current password/code and provider prompts. If enrollment/recovery is needed, use the supported interface. Do not share codes or bypass it. |
| 409 / shift changed / version conflict         | Reload and re-review authoritative evidence. Never blindly approve a changed record.                                                                       |
| Reading rejected / lower reading               | Recheck nozzle and physical meter. Escalate reset/replacement/correction evidence; do not invent an increasing reading.                                    |
| Active selling price required                  | Ask the authorized setup/price owner to resolve it. Do not alter prices to make a save pass.                                                               |
| Missing variance explanation                   | Investigate the category shown; record a factual SALES, CASH or STOCK explanation. Do not zero the amount.                                                 |
| Submission rejected                            | Check saved state, completeness, sealed meter evidence and required explanations. Read the server message.                                                 |
| Draft save partly failed                       | Several commands may already have succeeded. Keep the page open, use offered unchanged retry and recheck persisted evidence.                               |
| No connection / timeout / save outcome unclear | Avoid repeated clicks. Restore connection and inspect the record. Error wording alone cannot prove zero writes. Escalate uncertainty.                      |
| C Close meters frozen after interruption       | Preserve that browser/session and its recovery attempt. Do not clear session storage or change values to restart. Escalate if recovery is unavailable.     |
| Too many attempts / 429                        | Wait as instructed, then retry carefully; do not switch accounts to evade limits.                                                                          |
| APPROVED / LOCKED cannot edit                  | Use authorized correction support; do not recreate the transaction or alter the database.                                                                  |
| Missing figure / dash / incomplete report      | Check scope, dates and real setup. Treat as unavailable, not zero or proof of profitability.                                                               |
| Unexpected station time                        | Confirm authoritative station timezone with administrator. Do not substitute browser time.                                                                 |

## Escalation note

Record: staff contact; station; business date; shift; reconciliation identifier; action; approximate station time; state before/after; safe error text; whether you retried; and whether any result is uncertain. Preserve receipts and physical readings under station policy. Remove secrets and unrelated personal/customer information from screenshots.

Station supervisor: ______ Finance: ______ Owner: ______ Support/integration owner: ______

For suspected loss or discrepancy use the station's approved urgent reporting policy. If contacts or policy are missing, onboarding remains incomplete; the trainer must obtain them before live operations.
