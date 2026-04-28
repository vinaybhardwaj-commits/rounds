---
feature: marketing-handoff
title: Marketing Handoff Form (Lead → Care Team)
roles: [super_admin, hospital_admin, department_head, marketing_executive, ip_coordinator, ot_coordinator, doctor, surgeon]
pages: [/forms, /]
category: operations
related: [forms-system, multi-hospital-overview, cross-form-prefill, patient-list]
since: "2026-04-22"
keywords: [marketing, handoff, lead, intake, opd, admitting doctor, target hospital, target department, lead source, practo, coupon, surgical, attachment, picker, prefill, edited, print]
---

## What is this?

The **Consolidated Marketing Handoff** is the primary form Marketing fills to hand a lead off to the clinical team. It captures everything a doctor, IP coordinator, billing exec, and OT coordinator need to know about an inbound patient — from chief complaint to insurance, planned procedure to allocated room, lead source to coupon. One submission lands as cards in the patient's chat thread, the marketing channel, and the patient's department channel; downstream forms (Admission Advice, Surgery Posting, PAC Clearance) then pre-fill from this submission.

The form has 5 sections:
- **Section A — Clinical Handoff** (target hospital, admitting doctor, target department, clinical summary, allergies, priority, chief complaint)
- **Section B — Lead & Insurance** (lead source, insurance status, member type, financial category, coupon code, attachments)
- **Section C — Surgery Plans** (only shown if "Surgery planned?" = yes — proposed procedure, urgency, preferred surgery date, operating surgeon)
- **Section D — Bed/Room Allocation** (allocated room, bed, ward category)
- **Section E — Notes**

Big things to know:
- **18 fields are required.** A red asterisk marks them. Submit blocks until all are filled.
- **Doctor picker is mandatory.** Pick a real doctor from the 217-doctor reference roster. If the doctor isn't on file, choose "Other — type manually" at the bottom of the dropdown and fill the name in the field that appears.
- **Specialty auto-fills from the doctor pick.** When you pick a doctor, their specialty pre-fills `target_department`. Override it if needed.
- **Target hospital auto-fills from the doctor's primary affiliation** but you can override (see *multi-hospital-overview*).
- **Practo coupon auto-fill.** If you set Lead Source = "Practo", `coupon_code` is automatically stamped to `PRACTO300` (Rs 300 flat discount per the 22 Apr demo). Change the lead source away from Practo and the code clears automatically.
- **Cross-form prefill (latest submission).** When you re-open a marketing handoff for a patient that already has one, fields pre-fill from the most recent submission. Edited fields show a yellow "EDITED" tag so reviewers can see what changed.
- **Print view.** Tap "Print" on a submitted handoff to get a clean printable view that strips the EDIT highlights.
- **Version history.** Tap "Version history" to see every prior submission of this form for this patient.

## How to use it

**Filling a Marketing Handoff:**
1. Open the patient's detail view → **Forms** tab → tap "Marketing Handoff".
2. **Section A — Clinical Handoff:**
   - **Target Hospital** (required): pre-filled from doctor's affiliation. Override if marketing is re-routing.
   - **Clinical Summary** (required): 2–3 sentences for the care team.
   - **Allergies**: drug / food / latex with severity. Carries forward into Surgery Posting, PAC Clearance, Admission Advice.
   - **Admitting Doctor (picker)** (required): pick from the dropdown. Auto-fills name + specialty. Choose "Other" to type a name manually.
   - **Admitting Doctor (OPD/IPD)** (required): name auto-fills from picker. If you picked Other, type it manually.
   - **Target Department** (required): auto-filled from doctor's specialty. Override if needed.
   - **Priority** (required): Routine / Urgent / Emergency.
   - **Chief Complaint** (required): patient's stated reason for visit.
3. **Section B — Lead & Insurance:**
   - **Lead Source** (required): Walk-in / Practo / Insurance referral / Doctor referral / Other. Picking Practo auto-stamps the coupon.
   - **Insurance Status**: TPA / Cash / Pending verification.
   - **Member Type** (if Even member): Owner / Family.
   - **Financial Category**: TPA / Cash / Self-pay / Corporate.
   - **Coupon Code**: auto-fills `PRACTO300` if Lead Source = Practo. Editable.
   - **Attachments**: upload prescription, insurance card, prior reports.
4. **Section C — Surgery Plans** (only if you toggled "Surgery planned?" = yes):
   - **Proposed Procedure**: text or pick from packaged Charge Master procedures (filtered by surgical specialty).
   - **Surgery Urgency**: Elective / Urgent / Emergency.
   - **Preferred Surgery Date**.
   - **Operating Surgeon**: defaults to admitting doctor; toggle "Different operating surgeon?" to override.
5. **Section D — Bed/Room Allocation:**
   - **Ward Category**: General / Private / Suite / etc.
   - **Allocated Room** + **Bed Number**.
6. **Section E — Notes**: free text.
7. Tap **Submit**. You'll see the success screen with a card link to the patient's chat thread.

**Re-opening / editing a handoff:**

If you re-open a marketing handoff for a patient who already has one, the form will pre-fill from the latest submission. Fields you change get a yellow "EDITED" tag so the next reviewer can spot deltas. The submitted version becomes a new version in the chain (you can see the chain via the "Version history" button on the success screen or the patient detail).

**Soft warnings on submit:**

If the admitting doctor you picked isn't on file as affiliated with the target hospital, the form still submits — but you'll see a yellow warning banner: *"Dr X is not on file as affiliated with EHBR. Submitted anyway — flagged for review."* This isn't a blocker — it's a flag for ops to add the affiliation later. Your handoff is recorded normally. (See *multi-hospital-overview* for context.)

## Common questions

**Q: I picked a doctor and the target hospital auto-filled to EHRC, but the patient is being seen at EHBR. What do I do?**
A: Just change the Target Hospital dropdown to EHBR before submitting. The doctor pick auto-fills the *suggested* hospital, but you have final say. You'll get a soft-warning banner after submit (see above) — that's expected behavior, not an error.

**Q: My doctor isn't in the picker. What should I do?**
A: Scroll to the bottom of the doctor dropdown and pick "Other — type the name manually." The "Admitting Doctor (OPD/IPD)" text field will become editable; type the name there. After the form submits, ask Ops to add the doctor to the reference roster so the picker works next time.

**Q: I selected Practo as Lead Source and PRACTO300 appeared in the coupon field. Should I keep it?**
A: Yes — that's the standard Rs 300 Practo coupon and it's correctly auto-stamped. Override only if marketing has communicated a different code for this lead.

**Q: The form pre-filled with old data from a previous submission. Can I clear it?**
A: Yes — manually edit each field. The pre-fill is a convenience for follow-up handoffs (e.g. patient came back for a different procedure). If this is a fresh case, clear the fields you don't want to carry over. Edited fields will get the "EDITED" tag.

**Q: What happens after I submit?**
A: Three things happen automatically:
1. A card lands in the patient's chat thread (with all the handoff data summarized).
2. A copy goes to the **Marketing** cross-functional channel.
3. A copy posts to the patient's department channel.
4. If "Surgery planned?" = yes and the form is non-draft, a `surgical_cases` row in `draft` state is created so OT coordinators see it.
5. Allergies, BMI, and other shared fields are now available for cross-form prefill (Surgery Posting, PAC Clearance, Admission Advice).

**Q: Where do I find the "Form Submissions" panel and what's it for?**
A: On the patient's overview tab (left side, below the stage progress), there's a **Form Submissions** panel that lists every form submitted for this patient with its version count + latest submitter. Tap "All versions" on any row to drill into the full version chain.

**Q: I submitted a handoff and want to print it for the patient's physical file. How?**
A: After submit, tap "Version History" → click the version you want → tap the print icon. Print view strips the yellow EDIT highlights so it looks clean. Use Cmd+P / Ctrl+P to send to a printer.

## Troubleshooting

**Problem: I picked a doctor but the specialty / target hospital didn't auto-fill.**
Solution: The doctor record may be missing those fields in the reference roster. Check the doctor's profile in the system or contact Ops to backfill. In the meantime, manually type the specialty + pick the target hospital.

**Problem: The form submitted but I never saw a card in the patient's chat.**
Solution: GetStream may have hiccupped. The form is recorded in the database — check the patient's Form Submissions panel. If the card is genuinely missing, ask Ops to re-post it from the form submission ID.

**Problem: I'm getting a 403 error on submit even though all required fields are filled.**
Solution: 403 means a tenancy mismatch — you're trying to submit to a hospital you don't have access to. Check the Target Hospital dropdown matches your accessible set (multi-hospital users see only their hospitals).

**Problem: I see "EDITED" tags on fields I didn't change.**
Solution: That field has been edited by someone else (or in a prior version) and the tag persists across versions to flag historical changes. Hover over the tag for the change history.

## Edge cases

- **Surgery Section C hides automatically** if you set "Surgery planned?" = no. Re-toggling it back to yes restores the section but doesn't clear filled fields.
- **Ward category change after Bed allocation**: changing ward category clears the Bed Number field (different rooms in different wards). Re-pick the bed.
- **Operating Surgeon = admitting doctor by default.** Toggle "Different operating surgeon?" only if a different surgeon will operate.
- **Practo coupon clearing:** if you change Lead Source from Practo to anything else AND the coupon is still PRACTO300, it auto-clears. Custom coupon codes are not auto-cleared.
- **Submitting with 0 attachments:** allowed. Marketing can attach later by editing the submission via Version History.
