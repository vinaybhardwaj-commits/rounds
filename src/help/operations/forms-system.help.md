---
feature: forms-system
title: Creating & Filling Patient Forms
roles: [super_admin, department_head, doctor, surgeon, nurse, anesthesiologist, ot_coordinator, ip_coordinator, billing_executive, insurance_coordinator, pharmacist, physiotherapist, marketing_executive, support_staff]
pages: [/forms, /]
category: operations
related: [patient-detail-view, chat-messaging]
since: "2026-04-01"
keywords: [form, submit, fill, template, field, dropdown, wizard, conditional, survey, checklist, response]
---

## What is this?

The forms system is a flexible tool for creating and filling structured data collection forms — checklists, surveys, consent forms, intake forms, post-operative follow-ups, and more. Forms can have 16 different field types (text boxes, dropdowns, checkboxes, file uploads, ratings, and more), conditional logic (show/hide fields based on answers), multi-step wizard mode, and field referencing (later questions can reference earlier answers). Forms are linked to patient threads, and analytics track completion rates and drop-off points. You can create new forms at /forms/new, fill forms in the "Forms" tab of any patient, and view response analytics.

## How to use it

**Filling a Form:**
1. Open a patient's detail view and tap the "Forms" tab at the bottom (fifth tab).
2. You will see a list of forms available for this patient.
3. Tap a form to open it.
4. Fill in each field according to the instructions. Fields may be text boxes, dropdowns, date pickers, file uploads, rating scales, or other types.
5. Some fields may show or hide depending on your previous answers — this is conditional logic working automatically.
6. If the form is in "Wizard" mode, you will see a "Next" button to proceed step by step. Otherwise, all fields are on one page.
7. Once you have filled all required fields (marked with a red asterisk *), tap "Submit".
8. You will see a confirmation message and the form response is recorded.

**Creating a New Form:**
1. Go to /forms/new or tap the "Create Form" button from the Forms section.
2. Give your form a title (e.g., "Post-Op Pain Assessment") and optional description.
3. Choose form settings:
   - **Wizard Mode**: Enable if you want a multi-step form. Wizard shows one section per screen with "Next" buttons.
   - **Category**: Choose a category (e.g., "Intake", "Follow-up", "Consent") for organization.
4. Add fields by tapping "Add Field":
   - Choose a field type: Text, Number, Dropdown, Multi-select, Toggle, Currency, Rating, Date, Time, File Upload, Repeater, Person Picker, Computed Field, Radio Button, or Textarea.
   - Set field label and make it required or optional.
   - For dropdowns/radio buttons, add the list of options.
   - For computed fields, write a formula that calculates a value from other fields (e.g., total cost based on quantity × price).
5. To add conditional logic, click "Add Condition":
   - Choose which field to reference.
   - Choose a condition (equals, greater than, contains, etc.).
   - Choose which fields show/hide based on that condition.
6. To use field referencing, type {field_name} in text fields to pull in answers from earlier fields.
7. Tap "Save Form".
8. Your form is now available for staff to fill. You can link it to a patient, a department, or make it available hospital-wide.

## Common questions

**Q: What is "Wizard Mode" and should I use it?**
A: Wizard Mode breaks your form into multiple steps with "Next" buttons. Use it for long forms (10+ fields) to avoid overwhelming the user. For short forms (3–5 fields), regular mode is fine.

**Q: Can I change a form after I have already created it?**
A: Yes. Go to /forms, find the form, and tap "Edit". You can add, remove, or change fields. Previous responses are not affected, but new responses will use the updated form structure.

**Q: What is a "Computed Field"?**
A: A computed field automatically calculates a value based on other fields. For example, if you have "Quantity" and "Unit Price" fields, a computed field can show the total (Quantity × Unit Price). The user does not fill it — it fills automatically.

**Q: What is "Field Referencing"?**
A: It lets you pull a previous answer into a later question. For example, if field 1 asks "Patient name" and field 5 is a textarea, you can write "Please confirm {{ patient_name }} is the correct patient." The patient's name appears automatically in the message.

**Q: Can I see how many people filled out a form and how many abandoned it?**
A: Yes. Go to /forms and tap the form name to view analytics. You will see total submissions, completion rate, and a drop-off chart showing which fields cause people to abandon the form.

**Q: Can I use the same form for multiple patients?**
A: Yes. Create the form once and it becomes a template. Every time you fill it for a different patient, it is a new response linked to that patient.

## Troubleshooting

**Problem: A field that should show based on conditional logic is not appearing.**
Solution: Check the conditional logic rule — you may have set the wrong condition. Go to Edit Form, review the condition, and fix it. The condition must match exactly. For example, if the condition says "Department = OT" but the user selected "Operation Theater", they won't match. Use dropdowns instead of free text for conditions to avoid this.

**Problem: I filled out a form and submitted it, but it does not appear in the Forms tab anymore.**
Solution: The form is saved — it should still be in the list. Try refreshing the page. If it is still missing, the submission may have failed due to a network error. Try submitting again or contact support if the form data is lost.

**Problem: A computed field is showing an error or incorrect value.**
Solution: Check the formula in the computed field — it may reference fields that don't exist or use incorrect syntax. Go to Edit Form, find the computed field, and review/fix the formula. Common errors: using wrong field names, missing operators, or dividing by zero. Once fixed, recalculate the field.

## Recent updates (April 2026)

**Cross-form prefill (8 form types):** opening any of the 8 main form types — Marketing Handoff, Surgery Booking, Surgery Posting, PAC Clearance, Admission Advice, Financial Counseling, OT Billing Clearance, Admission Checklist — now pre-fills shared fields from the patient's prior submissions. Allergies captured at intake carry to PAC; BMI from Surgery Booking carries to PAC; demographics carry across all. See *cross-form-prefill* for full details.

**EDIT highlights:** any field you change from a pre-filled value gets a yellow "EDITED" tag so reviewers can spot deltas. Tags persist across versions to show historical changes.

**Version history button:** every form submission has a "Version history" button on the success screen + on the patient's Form Submissions panel. Tap to see every prior version with submitter, timestamp, and field-level diff.

**target_hospital filter (MH.4b):** the Marketing Handoff form's Target Hospital dropdown is now filtered to your accessible hospitals. EHIN doesn't appear (inactive). Hospital-bound users see only their hospital. Multi-hospital users see all their hospitals.

**Doctor↔hospital soft warning (MH.7a):** if you submit a Marketing Handoff with an admitting doctor whose primary hospital doesn't match the target hospital, the form still submits but you see a yellow warning banner: *"Dr X is not on file as affiliated with EHBR. Submitted anyway — flagged for review."* Logged for ops review. Submission is accepted normally.

**Print view:** every submitted form has a Print button. The print view strips EDIT highlights for clean output. Use Cmd+P / Ctrl+P to send to a printer.

**Form Submissions panel on patient overview:** see every form filled for a patient at a glance from their overview tab. See *patient-detail*.

**Marketing Handoff is a major refactor:** the marketing handoff form now has its own dedicated manifest with the full doctor-picker + 18-required-fields + target hospital + Practo coupon + version chain + print view documented. See *marketing-handoff*.
