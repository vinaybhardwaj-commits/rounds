---
feature: patient-list
title: Finding and Managing Patients
roles: [staff, department_head, super_admin, ip_coordinator, nurse, billing_executive, insurance_coordinator, pharmacist, ot_coordinator, anesthesiologist, marketing_executive, clinical_care, pac_coordinator, operations_manager, unit_head, medical_administrator, administrator]
pages: [/, /patients]
category: patient-care
related: [patient-stages, patient-forms, ot-schedule]
since: 2026-03-01
keywords: [patient, find, search, list, admit, discharge, UHID, IP number, stage, filter, create, add patient, archive]
---

## What is this?

The Patients tab shows every active patient in the hospital. You can search, filter by stage (Inquiry, Admitted, In Treatment, etc.), view patient details, and track their journey through the hospital.

## How to use it

1. Tap the **Patients** tab at the bottom of your screen.
2. You'll see a list of all active patients, sorted by most recent.
3. To find a specific patient, use the **search bar** at the top. You can search by name, UHID, or IP number.
4. To filter by stage, tap one of the stage buttons below the search bar (e.g., "Admitted", "In Treatment", "Discharge Planning").
5. Tap any patient to open their detail view — this shows their full timeline, forms, files, and chat thread.
6. To add a new patient, tap the **+** button in the top-right corner. Fill in the patient's name (required), UHID, and other details.
7. To upload multiple patients at once, use the **Upload** option in the create dialog and upload a CSV file.

## Common questions

**Q: What do the colored stage labels mean?**
Each patient has a stage that tracks where they are in their hospital journey. Inquiry (gray) = initial contact. Admitted (blue) = confirmed admission. In Treatment (green) = receiving care. Discharge Planning (orange) = preparing to leave. Discharged (purple) = has left the hospital. Archived = no longer active.

**Q: How do I change a patient's stage?**
Open the patient's detail view. Tap the current stage label near the top. A dropdown shows the valid next stages. Not all transitions are allowed — for example, you can't go from "Discharged" back to "In Treatment" directly.

**Q: What are the small colored tags (chiclets) next to patient names?**
Those show which forms have been completed for this patient. For example, "Adm Checklist" means the admission checklist is done. "OT Billing" means OT billing clearance is complete. Missing tags may indicate pending work.

**Q: How do I archive a patient?**
Open the patient detail view and scroll to the bottom. Tap "Archive Patient." You'll need to select a reason (discharged, LAMA, DAMA, expired, or other). Archived patients can be viewed later using the Archive filter.

**Q: I created a patient by mistake. Can I delete them?**
Patients cannot be deleted (for audit reasons), but you can archive them immediately with reason "Other" and a note explaining the error.

## Troubleshooting

**Problem: I can't find a patient I just created.**
Check that you're not filtering by a specific stage. Tap "All" to see every patient. Also check the search bar — clear it if it has old text.

**Problem: The stage dropdown won't let me select the stage I want.**
Stage transitions follow a specific order. For example, a patient must be "Admitted" before they can be moved to "In Treatment." If the transition you need isn't available, check if an intermediate step is missing.

## Recent updates (April 2026)

**HospitalChip on every row (MH.6):** Each patient row now shows a small color-coded chip with their hospital's short code — **EHRC** (blue) or **EHBR** (green). Multi-hospital users see chips on every row to disambiguate at a glance. Hospital-bound users still see the chip (visual confirmation).

**HospitalPicker on patient create (MH.4b):** The "+ New patient" form now opens with a Hospital field at the top. Hospital-bound users see it auto-filled with a Lock icon (read-only — your hospital). Multi-hospital users see "Pick a hospital…" dropdown — required, no default. The picker only shows hospitals you have access to (e.g. EHIN doesn't appear since it's inactive).

**Silent NULL hospital_id bug fix (MH.4b):** Patients created prior to MH.4b sometimes saved without a hospital_id (they'd disappear from your filtered list). All new patient creates now correctly stamp the hospital. Older patients with NULL hospital_id may need admin backfill.

**Tenancy filter on the list itself:** the patient list is server-side filtered by `user_accessible_hospital_ids()`. You only see patients at hospitals you have access to. Cross-hospital patients return 404 if you try to access them by URL.

See *multi-hospital-overview* for the broader context.
