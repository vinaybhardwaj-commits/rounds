---
feature: ot-planning-equipment
title: OT Planning Panel & Equipment Kanban
roles: [super_admin, hospital_admin, department_head, ot_coordinator, surgeon, anesthesiologist, ip_coordinator, nurse, biomedical, support_staff]
pages: [/ot, /equipment-kanban, /]
category: operations
related: [ot-surgery-readiness, marketing-handoff, anaesthetist-pac-queue, multi-hospital-overview]
since: "2026-04-25"
keywords: [ot, operating theatre, planning, equipment, kanban, drag, drop, requested, sourced, sterilized, ready, rental, vendor, eta, inventory, posting]
---

## What is this?

The OT module has two main views for coordinating surgery prep:

**OT Planning panel + tab** (`/ot`) — a single screen that shows every surgical case currently in the OT pipeline: cases scheduled for PAC, cases awaiting OT booking, cases booked for today, and cases in progress. Filterable by hospital, surgeon, urgency, date range. The right-side panel shows quick actions ("+ Equipment request", "+ PAC clearance form", "+ Schedule OT booking") for the selected case.

**Equipment Kanban** (`/equipment-kanban`) — a drag-and-drop board for tracking equipment requests through their lifecycle. Columns: **Requested** → **Sourced** → **Sterilized** → **Ready**. Cards represent individual equipment requests linked to surgical cases. Each card shows the patient name, hospital chip, equipment item, vendor (if rental), ETA, and a status pill.

The kanban replaces the older equipment list pages — same data, much faster visual scanning.

## How to use it

**OT Planning panel — daily routine for OT coordinators:**
1. Open `/ot` to see today's pipeline.
2. Use the filter bar at the top: Hospital (auto-filled to your hospital if hospital-bound, picker if multi-hospital), Surgeon, Urgency, Date Range.
3. Each case row shows: Patient name + hospital chip, surgical specialty, surgeon, planned procedure, urgency, current state (draft / scheduled_pac / pac_done / booked / ot_in_progress / done).
4. Tap a row to open the side panel on the right. The panel shows:
   - Patient summary
   - Linked equipment requests (with their kanban status)
   - Linked readiness items (PAC, fitness, consent, etc.)
   - Quick actions: + Equipment request, + Schedule OT, + Add readiness item, + PAC clearance
5. Tap "+ Equipment request" to open the equipment modal pre-filled with the case context. Pick from inventory (filtered by hospital), or toggle "Rental" to enter a free-text rental description with vendor info.

**Equipment Kanban — managing equipment requests:**
1. Open `/equipment-kanban`. You'll see four columns: Requested, Sourced, Sterilized, Ready.
2. Each card is one equipment request. Cards are color-coded by hospital (EHRC blue chip / EHBR green chip).
3. Drag a card to the next column to advance its status. The card auto-saves the new status with a timestamp + the actor.
4. Use the arrow keys for quick-advance: click a card to focus it, then press → to move it one column forward, ← to move it back.
5. Filter by hospital (top filter bar), by case, by urgency, or by rental flag.
6. Tap a card to open it for editing — change vendor, ETA, quantity, notes; or attach a serial number once the equipment is in hand.

**Creating an equipment request:**
1. From `/ot` panel: tap "+ Equipment request" with a case selected.
   OR from `/equipment-kanban`: tap "+ New request" (top-right).
2. The modal opens with the case context locked (read-only banner showing patient + procedure + hospital).
   - If you opened it without a case ("+ New request"), pick a hospital first (multi-hospital users only).
3. Pick an inventory item via search (filtered to your hospital's inventory). Items show category, brand, model, default vendor.
   - Or toggle "Rental request" to skip the picker and write a free-text rental description.
   - Or pick "Other" to type a custom item label.
4. Set quantity, vendor (auto-fills from inventory item if available), ETA, notes.
5. Submit. The card appears in the **Requested** column on the kanban.

**Rental flow:**

If the equipment is being rented (not from your inventory), toggle the "Rental request" switch at the top of the modal. The inventory picker disables and a free-text textarea appears for you to describe the rental (e.g. "C-arm — Phillips Veradius — Rs 8,000/day from MediRent"). Vendor / ETA fields stay editable. Rental cards on the kanban are tagged with a "RENTAL" pill.

## Common questions

**Q: I'm OT coordinator at EHRC. Why don't I see EHBR cases on /ot?**
A: Tenancy. The OT panel filters by your accessible hospitals — hospital-bound EHRC users only see EHRC cases. Multi-hospital users see both. (See *multi-hospital-overview*.)

**Q: A case in the panel doesn't have any equipment requests yet. Is that a problem?**
A: Not necessarily — some cases (e.g. minor procedures) don't require equipment. But if surgery is tomorrow and there's no equipment request, that's a flag. Use the "+ Equipment request" button on the panel to create one quickly.

**Q: The kanban doesn't show some cards I created last week.**
A: The kanban defaults to "active" cards (not yet Ready, or recently Ready). Use the date-range filter or the "include completed" toggle to see older cards.

**Q: Drag-and-drop doesn't work — the card snaps back when I release.**
A: You may not have permission to mutate equipment requests. Hospital-bound users can mutate within their hospital; cross-hospital drags are blocked. If you should have permission, check with admin. Otherwise use arrow-key quick-advance after focusing the card.

**Q: I dragged a card to "Ready" by mistake. Can I undo?**
A: Yes — drag it back to the previous column, or undo via your browser back button if you haven't navigated away. Glass mode also exposes per-action audit log under the patient's Activity tab so you can see who changed what when.

**Q: What's the difference between "Sourced" and "Sterilized" columns?**
A: **Sourced** = vendor confirmed, equipment is en route or in hand. **Sterilized** = equipment has cleared CSSD (sterilization). **Ready** = case-ready, on the OT trolley.

**Q: How do rental items get into "Sourced"?**
A: Same flow — once vendor confirms delivery, drag the rental card to Sourced. Rental items skip Sterilized in some cases (depends on the equipment) — check with Biomedical.

## Troubleshooting

**Problem: I clicked "+ Equipment request" but the modal shows "(No Case Assigned Yet)".**
Solution: You opened the modal from `/equipment-kanban` (not the OT panel), so there's no case context. Either pick a case from the OT panel first, or fill the form without a case (pick hospital + item) for a hospital-wide request that gets linked to a case later.

**Problem: I can't find the inventory item I need in the picker.**
Solution: The picker is filtered to your hospital's inventory. If the item exists at another hospital, it won't show up. Either ask Biomedical to add the item to your hospital's inventory, or use the "Other" option to type the item name manually.

**Problem: A case is showing in the wrong state on /ot (e.g. "scheduled_pac" but PAC is already done).**
Solution: Refresh the page first. If the state is genuinely wrong, the PAC clearance form may not have been submitted — open the case's panel, check linked PAC items. If the PAC form was submitted but the state didn't advance, it's likely a backend race; ask admin to advance the state manually via /admin/cases.

**Problem: The hospital chip on a kanban card shows EHRC but the patient is at EHBR.**
Solution: The case was probably created against the wrong hospital. Open the case → check `hospital_id`. Marketing handoff fixes this on submit (it syncs `patient_threads.hospital_id` to match the handoff's `target_hospital`). If still wrong, ask admin to manually fix.

## Edge cases

- **Cleanup cron** runs nightly and archives equipment requests older than 60 days that are stuck in any column except Ready. Check the kanban "archived" filter to see them.
- **Rental items in Ready column**: these stay until the case completes, then auto-archive. Don't delete the card — it's the audit trail for billing.
- **Multi-hospital OT planning**: super_admins can see and act on cases at any hospital. Hospital_admins are scoped to their hospital. Hospital-bound clinical users only see their own hospital.
- **Case in 'cancelled' state**: equipment requests linked to cancelled cases are hidden from the kanban by default. Use the "include cancelled" filter to see them for vendor follow-up (e.g. cancel the rental).
- **Quick-advance via arrow keys**: only works after clicking a card to focus it. The focus ring is subtle — look for a faint border. Pressing arrow keys without a focused card scrolls the page.
