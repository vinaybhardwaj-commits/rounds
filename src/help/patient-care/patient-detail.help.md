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
