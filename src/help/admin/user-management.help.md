---
feature: user-management
title: User Management & Access Control
roles: [super_admin]
pages: [/admin/profiles, /admin/approvals, /admin/profiles/add, /admin/profiles/import]
category: admin
related: [getting-started]
since: "2026-03-15"
keywords: [user, profile, role, approve, reject, signup, PIN, reset, import, CSV, admin, department, account]
---

## What is this?

User management is where admins control who can access Rounds and what they can do. New staff sign up by creating an account with their email, PIN, name, role, and department. The admin then approves or rejects them. Once approved, users log in with their email and PIN. Admins can also edit, import, or reset user credentials at any time.

There are 20 available roles—from super_admin (full system access) down to guest (read-only view). Each role has specific permissions for features like patient charts, billing, OT posting, etc.

## How to use it

### Adding a new user manually

1. **Navigate to user profiles** — Go to /admin/profiles. You'll see a table of all approved users with their email, role, department, and status.
2. **Click "Add User"** — This opens a form to add a new user directly (without waiting for signup).
3. **Fill in user details**:
   - Email: Must be @even.in domain. This is their login identifier.
   - Full Name: First and last name as it should appear in the app.
   - PIN: A 4-digit PIN they'll use to log in (along with email). Must be unique per user.
   - Role: Select from dropdown (e.g., Doctor, Nurse, Billing Executive, etc.). See role definitions below.
   - Department: Select their primary department (e.g., Neurology, Surgery, OT, Billing).
4. **Click "Save"** — User is created immediately. Send them their email and PIN. They can log in at /auth/login.

### Approving signup requests

1. **Go to approvals** — Click /admin/approvals. You'll see a list of pending signup requests with the applicant's name, email, requested role, and the date they applied.
2. **Review each request** — Click a request to see the full details (name, department choice, email verified).
3. **Approve or reject**:
   - Click "Approve" to activate their account. They receive an email notification and can log in immediately with their email and self-chosen PIN.
   - Click "Reject" to deny access. Provide a reason (optional). They receive a rejection email.

### Editing an existing user

1. **Find the user** — Go to /admin/profiles and search for the user by email or name, or scroll through the table.
2. **Click their row** — This opens their profile detail page.
3. **Click "Edit"** button — The form becomes editable.
4. **Update any field**:
   - Change role (e.g., from Nurse to Nurse Supervisor).
   - Change department.
   - Update their full name.
   - You can also see their PIN (masked) and choose to reset it.
5. **Save changes** — Click "Save". Changes take effect immediately. If you changed their role or department, they'll see updated menu options on next login.

### Resetting a user's PIN

1. **Open their profile** — Go to /admin/profiles, find the user, click their row.
2. **Click "Reset PIN"** — A dialog appears asking for a new 4-digit PIN.
3. **Enter new PIN** — Must be different from their current PIN.
4. **Click "Confirm Reset"** — On their next login, they'll be forced to enter the new PIN. The old PIN no longer works.

### Importing users from CSV or Excel

1. **Go to profiles** — Click /admin/profiles.
2. **Click "Import Users"** — This opens an import dialog with a template download.
3. **Download the template** — The CSV/XLSX has columns: Email, Full Name, PIN, Role, Department.
4. **Fill the template** — Add one row per user. Ensure emails are @even.in. Roles must match the available role list (see below). Departments must exist in the system.
5. **Upload file** — Select your filled template and upload. The system validates all entries.
6. **Review errors** — If any rows fail validation (e.g., invalid role, duplicate email), they'll be listed. Fix and re-upload, or skip them and import valid rows only.
7. **Confirm import** — Click "Import All Valid Users". Users are created immediately.

### Available roles and permissions

- **super_admin**: Full access. Can manage users, settings, and all features.
- **department_head**: Can view/manage their department's staff, patients, and analytics.
- **doctor**: Can create/edit patient records, view charts, order tests, view billing summary.
- **surgeon**: Doctor permissions + OT posting, surgery notes, implant tracking.
- **nurse**: Can view patient charts, log vitals, record notes, confirm readiness items.
- **anesthesiologist**: Can view patient records, record anesthesia plan, confirm ASA grade and readiness items.
- **ot_coordinator**: Can post surgeries, manage OT schedule, confirm OT readiness items.
- **ip_coordinator**: Infection prevention; can view infection flags, record isolation status, log procedures.
- **billing_executive**: Can view billing, create insurance claims, track deductions.
- **insurance_coordinator**: Can manage insurance pre-auth, enhancements, and claim submissions.
- **pharmacist**: Can view medication charts, dispense drugs, track inventory.
- **physiotherapist**: Can create and track rehabilitation plans.
- **marketing_executive**: Can view aggregate hospital metrics and referral data (no patient PII).
- **support_staff**: Can view and route patient inquiries, basic admin tasks.
- **guest**: Read-only access to non-sensitive hospital info. No create/edit permissions.

## Common questions

**Q: A staff member has left. How do I remove their access?**
A: Go to /admin/profiles, find their row, click it, and select "Deactivate User". Their account is marked inactive and they can no longer log in. Their historical data remains in the system for audit. You cannot delete users entirely—only deactivate.

**Q: I imported 50 users but made a typo in one role. Can I fix it without re-importing?**
A: Yes. Go to /admin/profiles, find that user, click their row, click "Edit", fix the role, and save. Single edits don't require a re-import of the whole file.

**Q: What happens if two users have the same PIN?**
A: The system prevents this. When you try to create or reset a PIN, it checks for uniqueness. If a PIN is already in use, you'll get an error and must choose a different one.

**Q: Can a user change their own PIN?**
A: Not yet. Only admins can reset PINs via /admin/profiles. Users cannot self-service change their PIN. If they forget it, they contact an admin for a reset.

## Troubleshooting

**Problem: When I try to import users, the system says "Invalid role: ABC". I'm sure I spelled it right.**
Solution: Role names are case-sensitive. Check the available roles list above and match the exact spelling and capitalization. For example, "ot_coordinator" not "OT Coordinator". Download the template again to see correct values in a dropdown.

**Problem: A user says they can't log in even though I approved them yesterday.**
Solution: Ask them to clear their browser cache (Cmd+Shift+Delete on Mac, Ctrl+Shift+Delete on Windows) and try again. If still failing, go to /admin/profiles, find their row, and verify their email is correct and their status shows "Active". If it shows "Inactive", click to re-activate them.

**Problem: I reset a user's PIN but they say the old PIN still works.**
Solution: They may be already logged in with the old session. Have them log out completely (close the browser) and log back in. The new PIN requirement only takes effect on login. If they're still having trouble, verify the reset timestamp in their profile—it should show today's date.
