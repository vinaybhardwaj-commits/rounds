---
feature: financial-counselling
title: Financial Counselling — Pre-Admission Insurance & Cost Estimation
roles: [super_admin, billing_executive, insurance_coordinator, ip_coordinator, department_head, doctor, surgeon, marketing_executive, customer_care]
pages: [/, /patients, /forms, /chat]
category: billing
related: [billing-insurance, forms-system, patient-detail-view, chat-messaging]
since: "2026-04-05"
keywords: [financial counselling, FC, insurance, cash, cost estimate, room rent, sum insured, TPA, pre-auth, proportional deduction, PDF, consent, counsellor, payment mode, package, surgery cost]
---

## What is this?

Financial Counselling (FC) is the critical pre-admission conversation between a hospital counsellor and a patient (or their family) about the cost of treatment. It happens after a surgeon recommends surgery in the OPD or before admission. The FC form captures everything: patient demographics, clinical details, payment mode (cash, insurance, or insurance + cash top-up), insurer and TPA details, cost estimates with room rent eligibility calculations, and signed consent.

Each FC session generates a legally protected PDF document that becomes part of the patient's permanent record. If a patient's treatment plan or cost estimate changes, a new FC version is created — the system tracks every revision with version numbers, change reasons, and AI-generated summaries of what changed between versions.

## How to use it

**Starting Financial Counselling for a Patient:**
1. Open the patient's detail view from the Patients tab.
2. Use one of these methods to start:
   - **Slash command**: In the patient's chat, type `/fc` and tap the "Financial Counselling" option. This opens the FC form pre-populated with the patient's name, UHID, and current clinical details.
   - **Forms tab**: Go to the patient's Forms section and tap "New Form", then select "Financial Counselling" from the form type dropdown.
   - **From the Forms page**: Navigate to /forms/new, select "Financial Counselling", and associate it with the patient.

**Filling the FC Form:**
1. **Patient Information** — Verify patient name, UHID, age, gender, contact number, and attendant details. These auto-populate from the patient record where available.
2. **Clinical Details** — Enter the planned procedure, diagnosis, and treating consultant name.
3. **Payment Profile** — Select the payment mode:
   - **Cash** — Patient pays entirely out of pocket. Skip the insurance section.
   - **Insurance** — Patient has insurance coverage. The insurance details section will appear.
   - **Insurance + Cash** — Patient has insurance but will also pay a cash top-up (common when the sum insured doesn't cover the full estimate). Both insurance details and cash components are captured.
4. **Insurance Details** (if applicable) — Select the insurer, TPA (Third-Party Administrator), enter the policy number, sum insured amount, and room rent eligibility category.
5. **Cost Estimate** — Enter the estimated surgery/treatment cost, package amount (if applicable), expected length of stay, room category, and daily room rent. The form automatically calculates room rent eligibility:
   - **Standard rooms**: Eligible up to 1% of sum insured per day.
   - **ICU**: Eligible up to 1.5% of sum insured per day.
   - If the patient's chosen room exceeds the eligible amount, a **proportional deduction risk** warning appears in red — this is a critical flag for the counsellor to discuss with the patient.
6. **Consent** — Record the counsellor's name, the person who facilitated admission, and confirm that the patient/attendant has understood the cost estimate and payment terms.
7. Tap **Submit**.

**Generating the PDF:**
1. After submission, open the patient's detail view and scroll to the "Financial Counselling History" section.
2. Tap "Generate PDF" next to the FC submission.
3. The system generates a professional PDF with the Even Hospital letterhead, all form data, the room rent eligibility calculation box, three signature areas (Patient/Attendant, Counsellor, Witness), and a legal footer.
4. Once the PDF is generated, the form submission is **locked** — it cannot be edited. This ensures the PDF and the form data always match.
5. Tap "Download" to save or print the PDF.

**Creating a Revised FC (New Version):**
1. If the cost estimate, treatment plan, or insurance details change, do **not** edit the existing FC — create a new one.
2. Open a new FC form for the same patient (via `/fc` or the Forms tab).
3. Fill in the updated details and provide a reason for the revision in the "Change Reason" field.
4. Submit. The system automatically links this as Version 2 (or 3, 4, etc.) and shows the full version chain in the patient's FC history.

**Viewing FC Version History:**
1. On the patient detail page, scroll to "Financial Counselling History" — you'll see all FC versions listed chronologically.
2. Each version shows: version number, who submitted it, when, payment mode, estimated cost, and whether a PDF has been generated.
3. You can also type `/fc-history` in the patient's chat to see the version timeline.

## Common questions

**Q: When should I fill out an FC form?**
A: Whenever a patient is recommended surgery or a procedure that requires admission. It should happen before admission — ideally in the OPD or during the pre-admission stage. For emergency admissions, fill it as soon as the patient is stabilised.

**Q: What is "proportional deduction" and why is it flagged in red?**
A: Proportional deduction happens when a patient books a room that costs more than their insurance eligibility. For example, if their sum insured allows ₹3,000/day room rent but they book a ₹5,000/day room, the insurance company may deduct not just the room rent difference but a proportion of the entire bill. This can result in a much larger out-of-pocket cost for the patient. The red warning ensures the counsellor discusses this risk before admission.

**Q: Can I edit an FC form after generating the PDF?**
A: No. Once the PDF is generated, the form is locked to maintain legal integrity. If something needs to change, create a new FC version instead. The previous version and its PDF remain in the permanent record.

**Q: What is the difference between "Insurance" and "Insurance + Cash" payment modes?**
A: "Insurance" means the patient expects full coverage from their policy. "Insurance + Cash" means the patient knows their insurance won't cover everything (e.g., the sum insured is lower than the estimate) and agrees to pay the difference in cash. This is common for high-cost procedures where the policy has a limit.

**Q: Who can fill out the FC form?**
A: Billing executives, insurance coordinators, IP coordinators, customer care staff, marketing/sales executives, department heads, and super admins all have access to the FC form.

**Q: Where does the FC event appear in the patient's record?**
A: In three places: (1) the patient's chat as a system message noting the FC submission and version, (2) the patient detail view under "Financial Counselling History", and (3) the patient's Form History section.

## Troubleshooting

**Problem: The insurance details section is not appearing in the FC form.**
Solution: Make sure you selected "Insurance" or "Insurance + Cash" as the payment mode in the Payment Profile section. The insurance fields only appear when one of these modes is selected. If you selected "Cash", insurance fields are hidden by design.

**Problem: The "Generate PDF" button is not showing for an FC submission.**
Solution: The PDF button only appears for Financial Counselling form types. Check that the form was created as type "Financial Counselling" (not a generic custom form). Also verify you are viewing the patient's detail page and scrolling to the FC History section.

**Problem: I submitted the wrong cost estimate and the PDF is already generated.**
Solution: You cannot edit a locked submission. Create a new FC version for the same patient with the corrected estimate. Add a clear change reason (e.g., "Corrected estimate — surgeon revised procedure scope"). The version history preserves both the original and the corrected version.

**Problem: The room rent eligibility calculation seems wrong.**
Solution: The calculation uses 1% of sum insured for standard rooms and 1.5% for ICU per day. Verify: (a) the sum insured amount is entered correctly, (b) the correct room category is selected, (c) the daily room rent matches the actual room charge. If your hospital uses a different eligibility formula, contact your admin to update the room rent rules.

**Problem: I cannot see the FC form in the slash command menu.**
Solution: Type `/fc` in the patient's chat message area. The form option should appear in the dropdown. If it does not, check that you have a role that is allowed to fill FC forms (billing_executive, insurance_coordinator, ip_coordinator, customer_care, marketing_executive, department_head, or super_admin). If your role is not listed, contact your admin.
