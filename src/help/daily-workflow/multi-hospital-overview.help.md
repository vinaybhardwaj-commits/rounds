---
feature: multi-hospital-overview
title: Working Across Multiple Hospitals (EHRC, EHBR)
roles: [super_admin, hospital_admin, department_head, doctor, surgeon, nurse, anesthesiologist, ot_coordinator, ip_coordinator, billing_executive, insurance_coordinator, pharmacist, physiotherapist, marketing_executive, support_staff]
pages: [/, /patients, /forms, /chat, /profile]
category: daily-workflow
related: [getting-started, marketing-handoff, patient-list, chat-messaging]
since: "2026-04-28"
keywords: [hospital, multi-hospital, ehbr, ehrc, tenancy, scope, picker, chip, target hospital, primary hospital, broadcast, cross-hospital]
---

## What is this?

Rounds is a multi-hospital system. The Even network operates EHRC (Race Course Road), EHBR (Brookefield), and EHIN (Indiranagar — not yet active). Every patient, form, case, and message belongs to exactly one hospital. As a staff member, you have a **primary hospital** (where you work) and a **scope** that controls how much you see across hospitals:

- **Hospital-bound:** you only see your hospital's patients, forms, broadcasts. Most clinical staff are hospital-bound. Your hospital is auto-filled on every form — you don't need to pick it.
- **Multi-hospital:** you work at more than one hospital (e.g. visiting consultants, regional managers). You'll see a hospital picker on patient creation and forms; pick which hospital this submission belongs to.
- **Central:** you span all hospitals (super_admins, central leadership). You see everything.

You can check which scope you have under your **Profile** page → "Hospital access" section.

## How to use it

**Spotting which hospital a patient belongs to:**

Every patient row in the patient list shows a small color-coded chip with their hospital's short code:
- **EHRC** chip (blue) — patient belongs to Race Course Road
- **EHBR** chip (green) — patient belongs to Brookefield

The same chip appears on form submission rows in the Forms screen, on the equipment kanban, and on user cards in admin pages. If you never see anything except your own hospital, you're hospital-bound — that's expected.

**Creating a patient (hospital is auto-set or chosen):**
1. Tap "+ New patient" on the patient list.
2. The first field at the top is the **Hospital** picker. If you're hospital-bound, it's already filled in (locked with a small lock icon — that's correct, you can't change it).
3. If you're multi-hospital, you'll see a "Pick a hospital…" dropdown. Choose where this patient should be filed.
4. Continue with the rest of the form (Patient Name, Phone, etc.) and submit.

**Marketing handoff to a different hospital:**

In the marketing handoff form, the **Target Hospital** field appears in Section A (Clinical Handoff). It's pre-filled from the admitting doctor's primary hospital, but you can override it if marketing is re-routing the patient to a different site (e.g. doctor primarily works at EHRC but the patient is being seen at EHBR). The dropdown only shows hospitals you have access to — EHIN is not yet active and won't appear.

If you pick a doctor + a target hospital that aren't on file as affiliated, the form will still submit but you'll see a yellow warning banner: *"Dr X is not on file as affiliated with EHBR. Submitted anyway — flagged for review."* This is intentional — your submission is accepted, but it's logged for someone to add the affiliation later.

**Broadcast channels in chat:**

In the channel sidebar, the "Broadcast" section has a row per hospital you can access:
- **EHRC · Broadcast** — read-only announcements for EHRC staff
- **EHBR · Broadcast** — read-only announcements for EHBR staff (only if you're multi-hospital or central)

System messages like SLA breach alerts post to the relevant hospital's broadcast channel.

**Profile page Hospital access section:**

Tap your avatar (top-right) → "View profile" to open your profile pane. Under "Hospital access" you'll see:
- Your scope (Hospital-bound / Multi-hospital / Central)
- A chip for each hospital you can access
- A ★ on your primary hospital

## Common questions

**Q: I'm a nurse at EHRC and I see a patient in the list with a green EHBR chip. Why?**
A: You shouldn't — hospital-bound users only see their own hospital's patients. If you're seeing this, you may have been mis-classified as multi-hospital. Ask an admin to check your role_scope on /profile.

**Q: What's the difference between "Hospital-bound" and "Central" scope?**
A: Hospital-bound users see only their primary hospital's data. Central users (super_admins, central leadership) see all hospitals. Multi-hospital is in between — you see a defined set of hospitals, not all of them.

**Q: I picked Dr X for a marketing handoff but warned that they're not affiliated with my target hospital. Should I worry?**
A: No, the form still submitted successfully. The warning is a soft check — it just means the doctor↔hospital link isn't on file yet. Operations will review and either add the affiliation or correct the doctor pick. Your patient handoff is recorded normally.

**Q: When I switch from creating a patient to creating a marketing handoff, do I have to pick the hospital twice?**
A: No. The patient already has a hospital_id. The marketing handoff just confirms the target hospital, which defaults to the doctor's primary affiliation. You don't need to re-pick.

**Q: Why is EHIN never in any dropdown or chip?**
A: EHIN is still in pre-launch. The system has it on file but marks it inactive, so it doesn't appear in pickers, doesn't get a broadcast channel, and can't be a target hospital. Once EHIN goes live, you'll see it appear automatically.

**Q: I'm a doctor who consults at both EHRC and EHBR. How does the system know that?**
A: An admin has marked you as multi-hospital scope and added affiliations for both hospitals. You'll see hospital pickers (not auto-fill) on create forms, and you'll see patients/forms from both hospitals in your lists.

## Troubleshooting

**Problem: I'm trying to create a patient but the Hospital field is empty and won't let me submit.**
Solution: You're a multi-hospital user and need to pick a hospital. Tap the dropdown at the top of the form and choose EHRC or EHBR. The submit button activates once you've picked.

**Problem: A patient I created last week is missing from my list.**
Solution: Check whether the patient was created with the right hospital_id. If you accidentally picked the wrong hospital and you're hospital-bound, you won't see them anymore. Ask an admin to check the patient's hospital assignment.

**Problem: I tried to view a patient via a direct URL and got "404 Not Found" or "Forbidden".**
Solution: That patient belongs to a hospital you don't have access to. The 404 (rather than a 403) is intentional — Rounds doesn't tell you whether the patient exists at another hospital. If you legitimately need access, ask an admin to either move the patient or expand your scope.

**Problem: I'm a hospital_admin for EHBR but I'm seeing EHRC patients on /admin/users.**
Solution: That shouldn't happen — hospital_admin scope filters every admin list to your hospital. Refresh the page; if it persists, your role assignment may have been changed. Ask a super_admin to verify your `role_scope` and `primary_hospital_id`.

## Edge cases

- **Cross-hospital patient transfer:** Not yet supported in v2. If a patient was created at the wrong hospital, ask an admin to update the patient's hospital_id in the database directly.
- **Visiting consultant doing surgery at a hospital they're not affiliated with:** This works — Rounds will warn but accept the submission. After the surgery, an admin should add the affiliation via the doctor-affiliations admin tool to suppress future warnings.
- **Sla-sweeper before broadcast channels exist:** If broadcast channels haven't been seeded yet (admin task), SLA breach messages fall back to the central-broadcast channel as graceful degradation.
- **EHBR patients created before the Hospital field existed:** Older patient records may have NULL hospital_id and be invisible in the new tenancy-filtered lists. Admin can backfill via SQL if needed.
