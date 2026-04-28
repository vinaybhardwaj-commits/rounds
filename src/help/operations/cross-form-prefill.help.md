---
feature: cross-form-prefill
title: Cross-Form Prefill (Allergies, BMI, etc. carry forward)
roles: [super_admin, hospital_admin, department_head, doctor, surgeon, nurse, anesthesiologist, ot_coordinator, ip_coordinator, billing_executive, marketing_executive]
pages: [/forms]
category: operations
related: [forms-system, marketing-handoff, anaesthetist-pac-queue]
since: "2026-04-25"
keywords: [prefill, autofill, carry forward, allergies, bmi, comorbidities, shared, patient context, version, history, edited, latest submission]
---

## What is this?

When you fill a form for a patient who's already had similar forms submitted, Rounds **pre-fills shared fields automatically** so you don't have to type the same data twice. This is the cross-form prefill engine — it's wired across 8 form types: Marketing Handoff, Surgery Booking, Surgery Posting, PAC Clearance, Admission Advice, Financial Counseling, OT Billing Clearance, Admission Checklist.

The prefill runs in two ways:
1. **Same form, latest submission:** opening a form for a patient who already has a submission of that form_type pre-fills from the most recent version. Useful for follow-up handoffs, re-submissions, corrections. Edited fields get a yellow "EDITED" tag.
2. **Cross-form prefill:** opening Form B for a patient who has Form A populates Form B's fields with overlapping data from Form A. Examples: allergies on Marketing Handoff carry forward to PAC Clearance, Surgery Posting, Admission Advice. BMI on Surgery Booking carries forward to PAC. Patient demographics carry across all forms.

You can override pre-filled values by just typing — no special action needed. Edited fields show the EDIT tag so reviewers can spot what changed.

## How to use it

**Daily flow (you don't need to do anything):**
1. Open any of the 8 form types in the Forms tab of a patient.
2. Look at the form — fields with grey background or a small "auto-filled" indicator are pre-filled from prior submissions.
3. Edit anything that needs updating. Edited fields turn yellow with an "EDITED" tag.
4. Submit. The new submission becomes the latest version + future forms will pre-fill from this one.

**Examples of what carries forward:**

- **Allergies** (drug, food, latex with severity) — captured at intake on Marketing Handoff, carries to PAC Clearance, Surgery Posting, Admission Advice.
- **BMI** — captured on Surgery Booking, carries to PAC.
- **Chronic conditions** (diabetes, hypertension, etc.) — captured on Marketing Handoff, carries to PAC.
- **Patient demographics** (name, age, gender, phone, UHID) — carries across all forms automatically (these are pulled from the patient_threads record, not duplicated).
- **Insurance info** (TPA, member type, policy number) — captured on Marketing Handoff, carries to Financial Counseling, Admission Advice.
- **Admitting doctor** — captured on Marketing Handoff, carries to Surgery Booking, Admission Advice.
- **Target hospital** — captured on Marketing Handoff, carries to all downstream forms (and syncs to `patient_threads.hospital_id`).
- **Coupon code** — Practo coupon auto-stamps + carries.

**Reviewing prior versions:**

Tap "Version history" on the form's success screen (or on the patient's Form Submissions panel) to see every prior version of this form for this patient. The version chain shows:
- Submission timestamp
- Submitter (full name + role)
- A diff view highlighting what changed vs the previous version

Each version is a new row, not an overwrite. The latest version is what shows up by default in the form when re-opened, but you can browse history to see what previous submissions said.

## Common questions

**Q: I opened a form and it's pre-filled with old data. How do I clear it for a fresh start?**
A: Manually clear the fields you don't want carried over. Pre-fill is convenience, not commitment — the data only persists if you submit. If you want to reset everything, refresh the page and the form re-opens with default state (still pre-filled from the latest version, but unmodified by your in-progress edits).

**Q: Why does the allergies field on PAC pre-fill from Marketing Handoff but not the airway notes?**
A: Different forms capture different things. Cross-form prefill only happens for fields that exist in both forms (and have semantic equivalence). Airway notes are PAC-specific — there's no upstream form that captures them, so they're always blank.

**Q: I see "EDITED" tags on fields I didn't change.**
A: Those fields were edited in a prior version (i.e. by a previous submitter). The tag persists across versions to flag historical changes. Hover over the tag to see who changed it and when.

**Q: Does the prefill engine work for forms in draft state?**
A: Yes — drafts are versions too. If a colleague saved a draft of a form, opening it as a teammate pre-fills with their draft data. Submitting promotes the draft to the latest version.

**Q: I submitted a Marketing Handoff with the wrong allergies. The PAC form already pre-filled with the wrong value. What do I do?**
A: Re-submit the Marketing Handoff with the correct allergies. The new version becomes the latest. Then either re-open the PAC form (it'll pre-fill from the corrected handoff) or manually correct the PAC form's allergies field.

**Q: Can I disable cross-form prefill for a specific form?**
A: Not currently. If pre-fill is genuinely getting in the way for a particular workflow, flag it with Ops — we can add an "always start blank" toggle on a per-form basis if there's enough demand.

## Troubleshooting

**Problem: I expected a field to pre-fill but it's blank.**
Solution: Check the patient's Form Submissions panel — does the upstream form actually have that field populated? If the upstream form was submitted with the field empty, prefill has nothing to copy. Backfill the upstream form first.

**Problem: A pre-filled value looks wrong (e.g. allergies show a drug the patient doesn't have).**
Solution: An earlier submission had bad data. Open Version History on the upstream form, identify the bad version, and re-submit a corrected version. Future prefills will use the latest (corrected) value.

**Problem: The "Version history" button doesn't show up on a form.**
Solution: The form may not have any prior versions yet (this is your first submission). Once you submit, future opens will show the button.

**Problem: I see different prefill values when I open the same form twice in different tabs.**
Solution: One tab is showing cached state. Refresh both tabs — the latest version is the source of truth.

## Edge cases

- **Pre-fill across hospital change:** if a patient was moved to a different hospital between submissions, prefill still uses the latest submission regardless of hospital. The form's `target_hospital` field shows the new hospital but other shared fields persist.
- **Pre-fill conflict between two upstream forms:** if both Marketing Handoff and Surgery Booking populate the same field (e.g. admitting doctor), the most recent submission wins. Order of submission matters.
- **Computed fields don't pre-fill from upstream forms** — they always recompute from current form data. Example: a "total cost" computed field on a billing form will recalculate, not pre-fill.
- **Anonymous patients (no UHID):** prefill still works — keying is by `patient_thread_id`, not UHID. UHID is just a display field.
- **Form schema changes:** if a field is added to a form schema after submissions exist, the new field is blank by default (no upstream data to pull from). Existing submissions don't retroactively fill new fields.
