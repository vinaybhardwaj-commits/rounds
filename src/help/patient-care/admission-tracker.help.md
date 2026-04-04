---
feature: admission-tracker
title: Admission & Discharge Tracking
roles: [super_admin, department_head, ip_coordinator, billing_executive, insurance_coordinator, nurse, doctor, surgeon]
pages: [/admin/admissions, /]
category: patient-care
related: [patient-detail-view, ot-surgery-readiness, billing-insurance]
since: "2026-03-15"
keywords: [admission, inpatient, bed, room, surgery schedule, discharge, tracker, dashboard, admitted, readmission]
---

## What is this?

The admission tracker is a dashboard that shows all patients currently in the hospital (inpatients) and those preparing for surgery or discharge. It has three main views: Active Admissions (who is in the hospital right now with room/bed details), Surgery Schedule (upcoming surgeries with surgeon and readiness status), and Discharge Pipeline (patients being prepared to go home). This is your command center for managing beds, coordinating surgery, and tracking the financial and insurance status of admitted patients.

Access it at the Admin menu → Admissions, or from the home screen if you have permission.

## How to use it

1. Go to the Admin menu and tap "Admissions" (or tap the Admissions card from the home screen if available to your role).
2. You will see three tabs: **Active Admissions**, **Surgery Schedule**, and **Discharge Pipeline**.

**Active Admissions Tab:**
3. View all currently admitted patients with their room number, bed number, admission date, and financial status.
4. Tap any patient card to open their full detail view and update their record.
5. Look for red flags (missing documents, overdue insurance approvals) shown as warning badges.

**Surgery Schedule Tab:**
6. View all upcoming surgeries with the patient name, surgeon, scheduled date/time, and readiness status.
7. Green = ready for surgery. Yellow = missing items. Red = not ready.
8. Tap a surgery to see what readiness items are missing (e.g., anesthesia clearance, equipment setup).
9. Coordinate with the relevant department to complete missing items so the patient can be marked ready.

**Discharge Pipeline Tab:**
10. View patients ready to be discharged or currently waiting for discharge paperwork.
11. Check if discharge summaries have been written, insurance claims submitted, and patient education completed.
12. Tap a patient to advance their discharge stage or resolve final blockers.

## Common questions

**Q: How do I update a patient's room or bed assignment?**
A: Open the patient's detail view from the Active Admissions tab, find the "Room" or "Bed" field, tap it, and select a new room or bed. The admission tracker will update automatically.

**Q: What does the yellow warning badge mean on a patient's card?**
A: It means the patient is missing something — check the patient detail view to see what's missing (e.g., insurance pre-auth, consent form). Complete the missing item to clear the warning.

**Q: Can I manually change a surgery's readiness status from "Not Ready" to "Ready" without completing all items?**
A: You should not do this without checking with the surgery and anesthesia teams. Tap the readiness status to see which items are blocking the surgery, and coordinate to complete them. Only mark ready when all items are truly done.

**Q: How do I know if a patient's insurance claim has been submitted?**
A: Open the patient's detail view and check the insurance/billing section. The claim status (submitted, approved, pending) will be shown. If not submitted, contact the billing team.

**Q: Can I schedule a discharge from the admission tracker?**
A: No, you cannot schedule discharge here. Use the Discharge Pipeline view to monitor discharge progress, and coordinate with the nursing and billing teams to move the patient through discharge stages.

## Troubleshooting

**Problem: I see a patient in Active Admissions but they should have been discharged yesterday.**
Solution: The patient's stage may not have been updated to "discharged" in their record. Open the patient's detail view, find the "Stage" field, and change it to "Discharged". The tracker will automatically move them out of Active Admissions.

**Problem: A surgery is stuck on "Not Ready" but I believe all items are done.**
Solution: Open the surgery from the Surgery Schedule tab and check the readiness checklist. An item may be marked incomplete even though it's done — contact the relevant staff member (e.g., OT coordinator, anesthesiologist) to mark it complete. If you have permission, you may be able to mark items complete yourself.

**Problem: I cannot see the Discharge Pipeline tab even though I'm an admin.**
Solution: Your role may not have permission to view discharge data. Ask your system administrator or department head to verify your role has discharge tracker access. Contact support if you believe you should see this data.
