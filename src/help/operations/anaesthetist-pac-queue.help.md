---
feature: anaesthetist-pac-queue
title: PAC Scheduling & Anaesthetist Queue
roles: [super_admin, hospital_admin, department_head, anesthesiologist, surgeon, ip_coordinator, ot_coordinator, nurse]
pages: [/anaesthetist-queue, /forms, /]
category: operations
related: [ot-planning-equipment, forms-system, marketing-handoff, ot-surgery-readiness]
since: "2026-04-26"
keywords: [pac, pre-anaesthetic, anaesthetist, queue, fitness, mallampati, asa, condition, card, clearance, schedule, publish, outcome, fit, defer]
---

## What is this?

PAC (**Pre-Anaesthetic Clearance**) is the formal sign-off by an anaesthesiologist that a patient is fit for surgery. Rounds has two surfaces for PAC:

**Anaesthetist Queue** (`/anaesthetist-queue`) — the daily worklist for any anaesthesiologist on duty. Shows every patient who's been scheduled for PAC but not yet cleared. Sorted by surgery date proximity (most urgent first). Each row shows patient + hospital chip + planned surgery + scheduled PAC date + key risk flags (allergies, comorbidities). Tap a row to open the patient detail view with the PAC clearance form ready to fill.

**PAC Clearance form** (a `pac_clearance` form_type submission) — the actual clinical form. Captures Mallampati score, ASA grade, airway notes, blood work review, allergies, current meds, condition cards (one per concurrent condition needing review — e.g. "diabetes uncontrolled, defer until HbA1c < 8"), and a final outcome (Fit / Conditional / Defer / Cancelled).

The flow is: marketing handoff → surgery booking → "+ Schedule PAC" (creates `surgical_cases` row in `pac_scheduled` state) → patient appears in Anaesthetist Queue → anaesthesiologist fills PAC clearance form → publishing the outcome moves the case to `pac_done` (or `cancelled` if Defer).

## How to use it

**Scheduling a patient for PAC (typically by IP coordinator):**
1. Open the patient detail view.
2. Tap "+ Schedule PAC" on the Overview tab (visible when the patient has a `surgery_booking` form on file or is in `pre_op` stage).
3. Pick a date (the OT calendar overlay shows anaesthesiologist availability).
4. Submit. The case state moves to `pac_scheduled` and the patient appears in the Anaesthetist Queue.

**Anaesthesiologist's PAC workflow:**
1. Open `/anaesthetist-queue`. The queue is auto-filtered to your hospital(s).
2. Patients are sorted by surgery date — most urgent at the top. Each row shows the patient name + hospital chip + planned surgery + risk flags.
3. Tap a patient row to open their detail view.
4. Tap the **PAC Clearance** form in the Forms tab (or the "+ PAC clearance" quick action).
5. Fill the form section by section:
   - **Patient summary** (auto-fills from prior forms): age, gender, BMI, allergies (carries from marketing handoff), chronic conditions.
   - **Airway assessment**: Mallampati (I–IV), thyromental distance, mouth opening, neck mobility, LEMON score.
   - **Cardiovascular**: BP baseline, recent ECG, echo if relevant.
   - **Respiratory**: SpO₂ on room air, recent chest X-ray, peak flow if asthma.
   - **Blood work review**: Hb, platelets, coagulation, electrolytes, RFT, LFT.
   - **Current medications**: allergies + drugs to hold pre-op (anticoagulants, oral hypoglycemics).
   - **ASA grade** (I–V): your overall risk classification.
   - **Condition cards**: tap "+ Add condition" for each issue requiring review or follow-up. Each card has: condition name, severity, action required (e.g. "Cardiology consult before OT", "Defer until HbA1c < 8"), reviewer, due-by date.
6. Pick **Outcome** at the bottom:
   - **Fit** — clear for surgery as planned.
   - **Conditional** — fit only if conditions on the cards are resolved (case stays in pre_op, OT will check before booking).
   - **Defer** — not fit; recommend re-booking after specific events (lab values, specialist consult). Auto-cancels OT booking.
   - **Cancelled** — patient no longer wants surgery / contraindicated.
7. Tap **Publish outcome**. The case state transitions accordingly.

**Reviewing condition cards:**

Condition cards persist with the case. After PAC, an IP coordinator or surgeon should:
- Tap each card to mark "Reviewed" with notes (e.g. "Cardiology consult done, cleared").
- Once all cards are reviewed and the patient is otherwise ready, OT can proceed with booking.

## Common questions

**Q: A patient appears in my queue but I don't have access to their hospital. What's wrong?**
A: That shouldn't happen — the queue filters by your accessible hospitals. Refresh the page. If they persist, ask admin to verify your `role_scope`.

**Q: I marked a patient as "Conditional" but the OT coordinator booked them anyway. How?**
A: Conditional is a soft gate, not a hard block. The condition cards are visible to OT but they can override (e.g. surgeon vouches that the condition is acceptable). If you want to block booking entirely, use Defer.

**Q: Can I edit a published PAC clearance later?**
A: Yes — open the form, edit fields, re-submit. The new submission becomes a new version (visible via "Version history"). The latest version's outcome is what's authoritative.

**Q: A patient was deferred. Can they re-enter the queue later?**
A: Yes. Once the deferred condition is resolved (e.g. HbA1c improves), the IP coordinator can "+ Schedule PAC" again on the patient's overview. The case re-enters the queue with a new PAC schedule.

**Q: I want to add a custom condition card type that isn't in the dropdown. How?**
A: Pick "Other" in the Condition Type dropdown and type the custom name. Ops can later add it to the standard dropdown if it's recurring.

**Q: I see a patient with a green "EHBR" chip. Am I supposed to clear them?**
A: Only if you're a multi-hospital anaesthesiologist with EHBR access. If you're EHRC hospital-bound, you shouldn't see EHBR patients — flag it with admin.

## Troubleshooting

**Problem: I tapped "Publish outcome" but got an error.**
Solution: One of the required fields is missing. Scroll up — fields with red asterisks must be filled. Common misses: ASA grade, Mallampati, blood work review section.

**Problem: The patient's allergies field is empty even though I know they have a peanut allergy.**
Solution: Allergies pre-fill from the marketing handoff. If the handoff didn't have them, type them manually now — they'll then carry forward to PAC, Surgery Posting, and Admission Advice for this patient.

**Problem: After publishing "Defer", the patient is still showing as `pac_scheduled` in the OT panel.**
Solution: Refresh the page — state transitions are async. If still wrong after 30s, the publish endpoint may have errored. Check the patient's Activity tab for the latest published outcome; if missing, re-publish.

**Problem: I'm filling PAC for a patient and the form pre-filled with someone else's data.**
Solution: That shouldn't happen — pre-fill is keyed by patient_thread_id. Reload the page. If it persists, take a screenshot and report it.

## Edge cases

- **Same-day PAC for emergencies:** OT coordinators can "+ Schedule PAC" with today's date for emergency cases. The patient appears at the top of the queue immediately.
- **Cancelled by patient:** if the patient cancels surgery before PAC, OT cancels the case (state → `cancelled`). The PAC schedule auto-clears and they leave the queue.
- **Anaesthesiologist on leave:** Rounds doesn't auto-reassign queues. Another anaesthesiologist on the same hospital can clear the same patient — multiple anaesthesiologists share the queue, and any of them can publish PAC outcome.
- **Multi-hospital anaesthesiologist:** if you cover both EHRC and EHBR, you'll see one combined queue with hospital chips on each row to disambiguate.
- **Re-booking after Defer:** when the patient becomes fit, the new PAC schedule creates a new version of the PAC form (via "Version history"). The Defer outcome is preserved as historical context.
