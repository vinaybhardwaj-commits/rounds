---
feature: ot-surgery-readiness
title: OT Surgery Posting & Readiness Checklist
roles: [super_admin, surgeon, anesthesiologist, ot_coordinator, nurse, ip_coordinator, department_head]
pages: [/, /admin/admissions]
category: operations
related: [admission-tracker, escalation-engine, duty-roster]
since: "2026-03-15"
keywords: [OT, surgery, operation, readiness, checklist, posting, wizard, implant, equipment, PAC, ASA, anesthesia, confirm]
---

## What is this?

OT (Operating Theatre) surgery readiness is a structured workflow for posting surgeries and tracking pre-operative readiness. When a surgeon schedules a patient for surgery, the system auto-generates a 22-item readiness checklist across five categories: clinical, nursing, OT, billing, and equipment. Each item has a responsible role and a due time before surgery.

The readiness donut on the admission card shows at a glance whether the surgery is ready (all items confirmed), partial (some items pending), or not ready (critical items missing). This ensures nothing falls through the cracks before the patient goes to the OT.

## How to use it

1. **Post a surgery** — On the admission or patient detail page, click "Post Surgery" button. This opens a multi-step wizard.
2. **Step 1: Patient & Procedure** — Select the patient from the list. Enter the procedure name (e.g., "Craniotomy", "CTVS Repair") or pick from the procedure master list. Enter procedure duration in minutes.
3. **Step 2: Surgical Team** — Select the primary surgeon from the list. Select the anesthesiologist. If a co-surgeon is needed, add them. All must be @even.in registered users.
4. **Step 3: OT Details** — Select the OT room (e.g., OT1, OT2, Cath Lab). Select surgery date and time. Check for room availability conflicts.
5. **Step 4: Equipment & Implants** — For surgeries using implants, click "Add Implant". Fill in implant name, serial number, cost, and expiry date. The system tracks rental vs. purchase. For equipment, select from the equipment master (e.g., C-arm, monitors).
6. **Submit** — Review summary and click "Post Surgery". The system auto-generates the 22-item readiness checklist and assigns items to responsible roles.
7. **Confirm readiness items one by one** — Each checklist item appears as a card in the "Readiness" section. Items include: ASA grade documented, consent signed, lab reports reviewed, NPO status confirmed, pre-med given, OT sanitation done, equipment checked, implant sterilized, nursing brief completed, anesthesia setup ready, etc. Click each item's checkbox to confirm. Time-remaining badge shows urgency.
8. **Bulk-confirm items** — If you're confirming multiple items as a role (e.g., OT Coordinator confirming all OT items), use "Confirm All" to mark them at once instead of clicking each one.
9. **Check readiness donut** — The donut on the admission card updates live. Green = ready, yellow = partial, red = not ready. Hover to see breakdown.
10. **View OT digest** — Each morning, the system posts a "Daily OT Schedule" message to the #ot-schedule Slack channel listing all surgeries for the day with readiness status.
11. **Handle overdue items** — If a checklist item's due time passes and it hasn't been confirmed, it auto-escalates: a notification is sent to the responsible role, and the item badge turns red.

## Common questions

**Q: What happens if I post a surgery but forget to add an implant that the surgeon requested?**
A: The readiness checklist will include "Implant verified & sterilized" as a pending item. You can edit the posted surgery by clicking the surgery card and selecting "Add/Edit Equipment" to add the implant mid-checklist. This reschedules the due time.

**Q: Can I confirm a checklist item before the due time?**
A: Yes. If all checks are done early (e.g., consent is signed 2 days before surgery), you can confirm the item immediately. You don't have to wait for the due time.

**Q: Who gets notified when an item overdue-escalates?**
A: The responsible role for that item (e.g., if "ASA grade documented" is overdue, the doctor responsible gets a notification). Department heads also receive a digest of overdue items for their department at 6 AM daily.

**Q: What's the difference between a rental implant and a purchase implant?**
A: Rental implants go back to the vendor after surgery. Their cost is booked as a charge but not as hospital inventory. Purchase implants stay with the hospital and are added to inventory. The system auto-flags rental implants with an expiry date to ensure timely return.

**Q: Can I cancel a posted surgery after the checklist is generated?**
A: Yes. Click the surgery card and select "Cancel Surgery". This marks the surgery as cancelled, removes it from the OT schedule digest, and cancels all pending checklist notifications. The surgery record stays in the system for audit purposes.

## Troubleshooting

**Problem: The OT room shows as available when I'm posting, but I get a conflict error after submit.**
Solution: Another user posted a surgery for the same room at the same time between when you checked and when you submitted. Refresh the page, pick a different time slot, or coordinate with the other team to adjust. The system prevents double-bookings on final submit.

**Problem: An equipment item I selected is not on the master list.**
Solution: Go to /admin/settings and click "Equipment Master". Add the new equipment with its code and category. Once saved, it will be available for all future surgery postings. For the current surgery, you can add it as a free-text note in the equipment section.

**Problem: The anesthesiologist I need to assign is not showing up in the dropdown.**
Solution: The anesthesiologist must be registered in the system with @even.in email and have the "Anesthesiologist" role assigned. Ask the super_admin to add them via /admin/profiles. Until then, you can note the anesthesiologist's name in the surgery comments and manually notify them.
