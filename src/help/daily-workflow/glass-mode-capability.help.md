---
feature: glass-mode-capability
title: "Glass Mode: Every Clinical User, Every Clinical Action"
roles: [super_admin, hospital_admin, department_head, doctor, surgeon, nurse, anesthesiologist, ot_coordinator, ip_coordinator, billing_executive, insurance_coordinator, pharmacist, physiotherapist, marketing_executive, support_staff]
pages: [/, /all-modules, /patient, /forms, /chat]
category: daily-workflow
related: [getting-started, patient-activity-timeline, multi-hospital-overview]
since: "2026-04-27"
keywords: [glass, capability, role, permission, gate, undo, banner, all modules, escape hatch, flat, every user, audit, identity, tenancy]
---

## What is this?

**Glass mode** is a system-wide policy change shipped 27 April 2026. Before Glass mode, many clinical actions (book an OT, schedule PAC, submit a marketing handoff, request equipment, advance a patient's stage) were gated by your role — only certain roles could do certain things. Other roles either didn't see the button or got a 403 if they tried.

After Glass mode, **any authenticated user with access to the hospital can perform any clinical action**. Identity (you must be logged in) and tenancy (you must have access to the hospital where the action is happening) are still enforced — those are non-negotiable. But the role-based gates on clinical actions are gone.

In exchange for that flexibility, the system added two safety nets:
1. **Audit log** — every clinical mutation writes to a per-patient timeline (see *patient-activity-timeline*). Anyone can see who did what when.
2. **24-hour Undo banner** — for the 6 highest-impact actions (discharge, archive, stage advance, PAC publish, case cancel, OT book), a yellow Undo banner appears immediately after the action and persists for 24 hours. Tap it to reverse the action.

Plus a third feature for navigation:
3. **All Modules page** at `/all-modules` — a domain-grouped grid of every clinical module the app has, accessible from your sidebar. Useful as the "I know X feature exists somewhere but where" escape hatch.

## How to use it

**Day-to-day: just do your work. The buttons are there.**

You don't need to remember "am I allowed to do X?" — if you can see the button, you can press it. Examples of things any clinical user can now do:
- **Book an OT** for a case (was: ot_coordinator only)
- **Schedule a PAC** for a patient (was: ip_coordinator only)
- **Submit a marketing handoff** (was: marketing_executive only)
- **Request equipment** (was: ot_coordinator + biomedical only)
- **Advance a patient's stage** (was: doctor + nurse only)
- **Verify a case** (was: anaesthesiologist + senior surgeon only)
- **Discharge a patient** (was: doctor only)
- **Archive a patient** (was: ip_coordinator only)
- **Cancel a case** (was: surgeon + ip_coordinator only)
- **Publish PAC outcome** (was: anaesthesiologist only)

The expectation is that you exercise judgment — if you're not sure whether a discharge is right, ask the patient's care team in their chat thread first. Glass mode trusts you to coordinate verbally before mutating.

**Undo banner — for high-impact actions:**

Right after you do one of the 6 high-impact actions (discharge, archive, stage advance, PAC publish, case cancel, OT book), a yellow banner appears at the bottom of the screen:

> *"Patient discharged. Undo within 24 hours."*  [Undo]

Tap **Undo** to reverse the action. The banner stays visible until either you undo, you dismiss it, or 24 hours pass.

After 24 hours the banner expires and the action becomes permanent (you'd need a super_admin to reverse via direct DB intervention). You can also see your recent undo-able actions on `/all-modules` → "Recent actions" section.

**All Modules page (`/all-modules`):**

Tap your avatar → "All Modules" (or visit `/all-modules` directly). You'll see a grid grouped by domain:
- **Patient** — Patient list, Detail view, Files, Activity, Form Submissions
- **Operating Theatre** — OT Planning panel, Equipment Kanban, Anaesthetist Queue
- **Forms & Tasks** — Forms, Chat tasks, Templates
- **Communications** — Channel sidebar, Direct messages, Broadcasts
- **Reports & Admin** — visible cards, plus locked cards (with a small lock icon) for super_admin-only tools

Each card links to the module. Locked cards show what super_admin tools exist but you can't enter them; the visible cards are everything you can actually use.

## Common questions

**Q: I'm a nurse and I just discharged a patient. Was I supposed to be able to do that?**
A: Yes — Glass mode allows it. But discharge is one of the 6 Undo-protected actions. If it was a mistake, tap Undo on the banner that appeared. If it was correct, you're done. The patient's care team will see the action in the patient's Activity tab so there's full transparency.

**Q: I'm uncomfortable having access to actions I'm not trained for. Can I hide buttons I don't want to see?**
A: Not currently. Glass mode is "every button visible to everyone" by design — the bet is that flexibility + audit + undo > role gating. If you genuinely don't want to see certain buttons, talk to your manager about a custom workflow.

**Q: What happens if I do an action by mistake and the 24h Undo expires?**
A: The action is permanent and you'd need super_admin help to reverse. Practically: most mistakes get caught within 24 hours by the patient's care team via the Activity timeline. Set yourself a calendar reminder if you're unsure about an action.

**Q: Are there ANY actions still gated by role?**
A: Yes — admin-elevation actions stay gated:
- `/admin/database` (super_admin only)
- `/admin/audit-log` (super_admin only)
- `/admin/api-performance` (super_admin only)
- `/admin/users` editing (super_admin)
- `/admin/doctor-affiliations` (super_admin or hospital_admin)
- Duty roster create/edit (super_admin or department_head)

Clinical mutations (the things in the patient's care pathway) are flat. System/admin tools are still gated.

**Q: Why did Glass mode happen? Wasn't role gating useful?**
A: Role gating was useful in v1 but became friction at scale. Examples that drove the change:
- Marketing handing off at 11pm and the only marketing user was off — care team couldn't update the handoff.
- Anaesthesiologist on leave; surgeon needed to publish PAC outcome to keep surgery on track.
- Nurse seeing a stage was wrong but having to wait for a doctor to advance it.

Glass mode unblocks all those + adds audit/undo so accountability isn't lost.

**Q: Can I see my recent actions to make sure I haven't done something I shouldn't?**
A: Yes — open `/all-modules` → "Your recent actions" (super_admin: open `/admin/audit-log` for the global view). You'll see your last 50 mutations with quick-undo links for the 6 protected actions.

## Troubleshooting

**Problem: I tapped a button and got a 403 error.**
Solution: Either you're not authenticated (your session expired — refresh + log in) OR the action targets a hospital you don't have access to (tenancy gate, not a role gate). Check the URL/patient hospital chip.

**Problem: The Undo banner disappeared before I could tap it.**
Solution: It auto-dismisses after page navigation. Open `/all-modules` → "Your recent actions" — recent undo-able actions are listed there with the same Undo button. Still within 24h? You can undo from there.

**Problem: I tapped Undo on a discharge but the patient is still showing as discharged.**
Solution: Refresh the page. If still not undone, the undo dispatcher may have errored — check the patient's Activity tab for an `.undo` event. If absent, retry undo or contact super_admin.

**Problem: I can see a button but it doesn't do anything when I tap it.**
Solution: That's a UI bug, not a permissions issue. Glass mode flattened access but doesn't fix UI defects. Take a screenshot, note the URL + button, and report it.

## Edge cases

- **Identity gate stays:** anonymous users still get 401 on every clinical action. You must be logged in.
- **Tenancy gate stays:** even with Glass mode, you can't act on a patient at a hospital you don't have access to. The gate returns 404 (not 403) to avoid leaking that the patient exists at another hospital.
- **Cascade undos:** undoing a high-impact action restores the headline field but doesn't reverse downstream side effects (e.g. undoing a PAC publish doesn't un-cancel an OT booking that was already triggered). For full reversal, ask super_admin.
- **Concurrent actions:** if two users do the same action simultaneously (e.g. both discharge the same patient), the second action sees the patient already discharged + no-ops. The Activity timeline shows both attempts.
- **Glass mode telemetry:** every cross-role action fires a telemetry event (`glass.cross_role_action`). Used to validate the bet that "wide access doesn't cause chaos." Anonymous, aggregated only.
