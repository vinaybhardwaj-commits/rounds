---
feature: billing-insurance
title: Insurance Claim Lifecycle & Billing Tracking
roles: [super_admin, billing_executive, insurance_coordinator, ip_coordinator, department_head]
pages: [/, /patients]
category: billing
related: [patient-detail-view, admission-tracker, forms-system]
since: "2026-03-15"
keywords: [billing, insurance, claim, pre-auth, enhancement, discharge, TPA, settlement, room rent, deduction, recovery]
---

## What is this?

Insurance claim lifecycle tracking guides patients and staff through the full billing journey from admission to settlement. The system tracks five key phases: discharge timeline, claim lifecycle (pre-authorization → enhancement → final claim → settlement), financial counseling with room rent calculation, enhancement alerts, and recovery metrics.

When a patient arrives with insurance, their claim moves through stages automatically. You can view the entire financial story on the patient's detail page, track what the insurance company has approved, and know exactly what deductions or enhancements are pending.

## How to use it

1. **Start financial counseling** — When a patient is admitted with insurance, click the financial counseling form link on their admission card. This opens the room rent calculator.
2. **Enter room rent details** — Select patient's booked room type and expected length of stay. The calculator shows estimated room charges and insurance limits.
3. **Track pre-authorization** — In the patient detail view, scroll to "Insurance" section. Here you see the pre-auth amount approved by the TPA (Third-Party Administrator).
4. **Monitor running bill** — The "Current Approved Amount" badge shows how much the TPA has cleared so far. When the bill approaches this amount, an enhancement alert appears.
5. **Request enhancement** — Click the enhancement alert or use slash command `/enhance` to request higher approval from the insurance company. Provide reason and updated bill estimate.
6. **View claim phases** — Under "Billing Intelligence" on the admin dashboard, see all claims in phases: pre-auth (pending), active (in-hospital), discharge (preparing), enhancement (awaiting TPA response), settlement (closed).
7. **Close claim after discharge** — Use slash command `/billclose` to finalize the claim once patient is discharged and all deductions are settled.
8. **Benchmark recovery** — Check the billing intelligence dashboard to see recovery rate (amount recovered vs. total billed) and TAT metrics (time from discharge to settlement).

## Common questions

**Q: What's the difference between pre-auth and enhancement?**
A: Pre-auth is the initial approval from insurance for estimated charges. Enhancement is a request to increase that approval if the actual bill runs higher than expected.

**Q: Can I change the room rent calculation after the patient is admitted?**
A: Yes. Click "Edit" on the financial counseling form to update room type or expected stay. The system recalculates and may trigger an enhancement alert if charges have increased.

**Q: Where do I see what the patient owes out-of-pocket?**
A: On the patient's detail page, the "Insurance" section shows "Patient Liability" — this is the gap between total bill and insurance approval. If there are deductions, they're shown separately.

**Q: How do I know if the insurance company approved my enhancement request?**
A: Check the "Enhancement Status" badge on the patient card. It shows "Approved", "Pending", or "Rejected". You can also see the full response history by clicking the badge.

**Q: Can I submit the final claim before the patient is discharged?**
A: No. Use `/discharge` to mark the patient as discharged first. Only then can you use `/submit` to send the final claim to the insurance company.

## Troubleshooting

**Problem: The room rent calculator is showing old room prices.**
Solution: Go to /admin/settings and update the room rent master data. The calculator pulls live rates from there. Changes apply instantly to new calculations.

**Problem: An enhancement alert appeared, but I already requested one yesterday.**
Solution: Check the "Enhancement History" tab on the patient detail page. If a previous request is still "Pending", don't submit a duplicate. Wait for the TPA response or use `/enhance` with an updated amount to modify the pending request.

**Problem: The recovery rate on the billing dashboard looks wrong — it shows 85% but I know we collected more.**
Solution: Verify that all discharge closures have been marked with `/billclose`. Until a claim is closed, settlements aren't included in the recovery calculation. Also check that all payments have been recorded in the settlement section.
