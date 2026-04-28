---
feature: getting-started
title: Getting Started with Rounds
roles: [staff, department_head, super_admin, ip_coordinator, nurse, billing_executive, insurance_coordinator, pharmacist, ot_coordinator, anesthesiologist, marketing_executive, clinical_care, pac_coordinator, operations_manager, unit_head, medical_administrator, administrator, guest]
pages: [/, /auth/login, /auth/signup, /auth/pending]
category: daily-workflow
related: [chat-messaging, patient-list, daily-briefing]
since: 2026-03-01
keywords: [login, sign up, PIN, password, getting started, new user, first time, navigation, tabs, how to start, help, account, approval]
---

## What is this?

Rounds is Even Hospital's operations app. It helps you manage patients, communicate with your team, fill out forms, and track tasks — all from your phone or computer. This guide walks you through your first login and the basics of navigating the app.

## How to use it

1. **Sign up:** Go to the Rounds URL and tap "Sign Up." Enter your @even.in email address, your full name, and choose a 4-digit PIN. This PIN is your password — remember it.
2. **Wait for approval:** After signing up, your account needs to be approved by an admin. You'll see a "Pending Approval" screen. This usually takes less than a day.
3. **Log in:** Once approved, go back to the login page. Enter your email and 4-digit PIN.
4. **Navigate using the bottom tabs:**
   - **Patients** — See all active patients, search, filter, and manage them.
   - **Chat** — Message your team, read updates, respond to requests.
   - **Forms** — Fill out clinical and operational forms for patients.
   - **Tasks** — See your daily briefing, overdue items, and OT schedule.
   - **Me** — Your profile, settings, and logout.
5. **Start by checking your Chat** — this is where you'll find messages from colleagues, patient updates, and any urgent escalations.

## Common questions

**Q: I forgot my PIN. How do I reset it?**
Go to the "Me" tab and tap "Change PIN." You'll need to enter your current PIN first. If you've completely forgotten it, ask an admin to reset your account.

**Q: My account says "Pending Approval." How long does this take?**
Typically less than one working day. The GM or a department head needs to approve your account. If it's been more than a day, ask your department head to check.

**Q: Can I use Rounds on my phone?**
Yes. Rounds works on any phone browser. For the best experience, add it to your home screen — it works like a native app (it's a PWA). On iPhone: tap Share > Add to Home Screen. On Android: tap the three dots > Add to Home Screen.

**Q: What's my role and how does it affect what I see?**
Your role (staff, nurse, billing executive, department head, etc.) determines which features you can access. For example, only department heads and admins can see the AI briefing or manage users. Most features are available to all roles.

**Q: I see five tabs at the bottom. What's each one for?**
Patients = patient list and management. Chat = team messaging. Forms = clinical and operational forms. Tasks = daily briefing, overdue items, OT schedule. Me = your profile and settings.

## Troubleshooting

**Problem: I can't log in even though I was approved.**
Make sure you're using your @even.in email (not a personal email) and the correct 4-digit PIN. If you've tried 5 times in 15 minutes, you'll be locked out temporarily — wait 15 minutes and try again.

**Problem: The app looks different on my phone vs my computer.**
Rounds is designed to work on both, but the layout adjusts. On mobile, you'll see bottom tabs and compact views. On desktop, you'll see a wider layout with sidebars. The features are the same.

**Problem: The app isn't loading or shows a blank screen.**
Try refreshing the page. If it still doesn't work, clear your browser cache or try a different browser. If the problem persists, the server may be down — check with IT.

## Recent updates (April 2026)

**Multi-hospital aware:** Rounds is now a multi-hospital system covering EHRC (Race Course Road) and EHBR (Brookefield), with EHIN (Indiranagar) coming soon. Most clinical staff are "hospital-bound" — you only see your hospital's data, hospital is auto-filled on every form. A few users are "multi-hospital" or "central" scope. Open your Profile page → "Hospital access" section to see your scope + accessible hospitals. See *multi-hospital-overview*.

**`/all-modules` page:** every authenticated user can visit `/all-modules` (or tap the entry in the sidebar / Profile page) to see a domain-grouped grid of every clinical module. Useful as the "I know X feature exists somewhere but where" escape hatch. See *glass-mode-capability*.

**Glass mode (capability flat):** since 27 April 2026, every authenticated user can perform every clinical action (book an OT, schedule PAC, discharge a patient, etc.) regardless of role. Identity + tenancy still enforced. The 6 highest-impact actions get a 24h Undo banner. See *glass-mode-capability*.

**Activity tab on every patient:** see the full audit timeline (who did what when) for any patient via the Activity tab in their detail view. See *patient-activity-timeline*.

**Form Submissions panel + cross-form prefill:** opening a form for a patient pre-fills shared fields from their prior submissions (allergies, BMI, demographics). See *cross-form-prefill*. Form Submissions panel on patient overview shows every form filled at a glance.

**Marketing Handoff is now a polished workflow:** doctor picker mandatory, 18 required fields, target hospital, Practo coupon auto-stamp, version chain with EDIT highlights, print view. See *marketing-handoff*.

**OT Planning panel + Equipment Kanban:** see and act on OT pipeline + drag equipment requests through the kanban. See *ot-planning-equipment*.

**Anaesthetist Queue:** anaesthesiologists have a dedicated daily worklist for PAC scheduling and clearance. See *anaesthetist-pac-queue*.

**Chat tasks:** turn any chat message into a tracked actionable item with an assignee and status lifecycle. See *chat-tasks*.

**Help has new manifests:** if you're not sure how a new feature works, ask the helpbot at /help/ask. The knowledge base now covers all of the above.
