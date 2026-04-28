---
feature: patient-detail-view
title: Viewing & Editing Patient Details
roles: [super_admin, department_head, doctor, surgeon, nurse, anesthesiologist, ot_coordinator, ip_coordinator, billing_executive, insurance_coordinator, pharmacist, physiotherapist, marketing_executive, support_staff]
pages: [/, /patients]
category: patient-care
related: [patient-list, chat-messaging, file-management]
since: "2026-03-15"
keywords: [patient, detail, edit, stage, PAC, changelog, history, inline edit, advance stage]
---

## What is this?

The patient detail view opens when you tap on any patient card from the patient list. It shows all information about a patient — name, age, contact, admission date, medical history, and current stage in their hospital journey (from outpatient to discharged). You can edit almost any field by tapping it directly (inline editing), track the patient's progress through each stage, and see a complete changelog of all changes made to this patient's record.

This is your central workspace for managing an individual patient's care from admission through discharge.

## How to use it

1. From the home screen or patient list, tap any patient card to open their detail view.
2. To edit any field (name, phone, admission notes, etc.), tap the field directly — it will turn editable.
3. Type your changes and tap outside the field or press Enter to save.
4. To advance a patient to the next stage (e.g., from OPD → Pre-Admission), tap the "Stage" field and select the next stage from the dropdown.
5. To see a record of all changes made to this patient, scroll down to the "Changelog" tab at the bottom.
6. To upload documents or view existing files, tap the "Files" tab.
7. To message the team about this patient, tap the "Chat" tab.
8. To track patient care plans and readiness items, tap the "Care Plan" or "Readiness" tabs if available.

## Common questions

**Q: Can I edit a patient's stage without approval?**
A: Yes, you can advance stages freely within your role's permissions. If you do not see a stage option, you may not have permission to move the patient to that stage — contact your department head.

**Q: What happens if I edit a field by mistake?**
A: All changes are logged in the Changelog. If you need to revert an edit, contact your system administrator who can restore previous versions.

**Q: Does the patient see changes I make to their record?**
A: No. Changes you make are internal hospital records only. The patient does not receive notifications of updates unless you explicitly message them through a patient communication channel.

**Q: Can I bulk-edit multiple patients at once?**
A: No, editing is one patient at a time. Return to the patient list and open another patient's detail view if you need to update multiple records.

**Q: How do I know if another staff member has edited this patient's record recently?**
A: Check the Changelog tab — it shows a timestamp and the name of the person who made each change.

## Troubleshooting

**Problem: A field won't let me edit it (appears locked or greyed out).**
Solution: You may not have permission to edit that field. Ask your department head or admin if your role should have edit access to this field. Some fields (like auto-generated IDs) cannot be edited.

**Problem: I tapped a field to edit but nothing happened.**
Solution: Try tapping again — the field should highlight and turn into an editable text box. If it still doesn't respond, refresh the page and try again. If the problem persists, contact support.

**Problem: I advanced a patient to a new stage but I see an error message.**
Solution: The patient may not be ready for that stage (missing documents, incomplete readiness items). Check the error message, complete any missing items (e.g., upload consent forms), and try again.

## Recent updates (April 2026)

**Activity tab (Glass mode):** A new "Activity" tab in the bottom navigation shows the full audit timeline for this patient — every form submitted, every state transition, every case mutation, with actor + timestamp + summary. See *patient-activity-timeline* for the full how-to. Visible to every authenticated user with hospital access.

**Form Submissions panel on Overview:** the patient overview tab now shows a Form Submissions panel listing every form filled for this patient with version count + latest submitter. Tap "All versions" on any row to drill into the version chain. Tap "Version history" on any submission to see the per-version diff.

**Version chain on every form:** each form submission now lives on a versioned chain. Re-submitting a form for the same patient creates a new version (not an overwrite). Edited fields between versions are tagged with a yellow "EDITED" pill so reviewers can see deltas. Print view strips the EDIT highlights for clean printable output.

**Doctor + Department pickers persist:** changes to "Primary Consultant" and "Department" auto-save on Enter or blur. No need to tap a Save button.

**HospitalChip on the header:** the patient detail header now shows the patient's hospital chip alongside their stage. Useful for multi-hospital users opening many patients in succession.

**Schedule PAC quick action:** any authenticated user with access can tap "+ Schedule PAC" on the overview tab when the patient has a surgery_booking on file or is in `pre_op` stage. Glass mode flattened the role gate. See *anaesthetist-pac-queue*.
