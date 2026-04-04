---
feature: leadsquared-integration
title: LeadSquared CRM Integration & Patient Sync
roles: [super_admin]
pages: [/admin/leadsquared]
category: admin
related: [patient-list, patient-detail-view]
since: "2026-04-01"
keywords: [LeadSquared, LSQ, CRM, sync, lead, import, webhook, OPD, IPD, integration]
---

## What is this?

LeadSquared (LSQ) is a customer relationship management (CRM) system that tracks hospital leads—potential patients who've inquired about services. The Rounds LeadSquared integration automatically syncs leads from LSQ into Rounds as new patients. OPD (Outpatient Department) leads become opd-stage patients, and IPD (Inpatient Department) leads become pre-admission-stage patients.

This eliminates manual data entry and ensures marketing-generated leads flow directly into clinical care workflows. Every synced patient gets an "LSQ" badge on their card so you know they came from the CRM.

## How to use it

### Setting up the integration

1. **Go to LSQ settings** — Navigate to /admin/leadsquared. You'll see the integration dashboard.
2. **Check LSQ credentials** — Verify that the LSQ API key and account ID are configured. If not, ask your IT team to provide them from your LSQ account settings.
3. **Test connection** — Click "Test Connection". The system pings LSQ to verify credentials. You'll see "Connected" if successful, or an error message if credentials are wrong.

### Choosing a sync method

The system offers three ways to sync patients from LSQ to Rounds:

**Method 1: Real-time webhook (instant)**
- LSQ sends data to Rounds instantly when a new lead is created or updated.
- Pros: Fastest, no delay, lead appears in Rounds within seconds.
- Cons: Requires webhook URL to be configured in LSQ account.
- Setup: Click "Enable Webhook Sync" on the dashboard. Copy the webhook URL and paste it into your LSQ account's webhook settings.

**Method 2: Polling every 15 minutes**
- Rounds checks LSQ every 15 minutes for new or updated leads.
- Pros: No webhook setup needed, works automatically.
- Cons: Up to 15-minute delay before a lead appears in Rounds.
- Setup: Click "Enable Polling Sync". The system starts checking LSQ every 15 minutes.

**Method 3: Manual trigger**
- You manually sync whenever you want via a button click.
- Pros: Full control, useful for testing or syncing historical data.
- Cons: Requires you to remember to sync; leads don't auto-import.
- Setup: Click "Sync Now" button to fetch the latest leads from LSQ immediately.

### Monitoring sync activity

1. **View sync history** — On the /admin/leadsquared dashboard, the "Sync History" table shows:
   - Last sync timestamp (when the last sync ran).
   - Number of leads synced in that run.
   - Status (Success, Partial Success, Failed).
   - Any error messages.

2. **Check patient count** — The dashboard shows "Total LSQ Patients Synced This Month" as a metric card. This tells you how many new patients came from the CRM.

3. **API call log** — Scroll down to the "API Call Log" section. This shows:
   - Each API request to LSQ (timestamp, request type, response code).
   - Green checkmarks = successful calls (200, 201 response codes).
   - Red X = failed calls (4xx, 5xx errors) with error details.
   - Useful for debugging if a sync fails.

### Finding synced patients in Rounds

1. **Go to patient list** — Navigate to / or /patients.
2. **Look for "LSQ" badge** — Any patient card with an "LSQ" badge was synced from LeadSquared.
3. **Filter by source** — In the patient list filters, select "Source: LeadSquared" to show only synced patients.
4. **View LSQ details** — Click a synced patient's card. In the "Source" section, you'll see:
   - "LeadSquared" label.
   - LSQ lead ID (for cross-reference).
   - Original lead creation date from LSQ.
   - Any custom fields from LSQ (e.g., referral source, lead channel).

### Understanding patient stages after sync

- **OPD leads** → Synced as **opd-stage** patients. They appear in the OPD patient list and can be scheduled for outpatient consultations.
- **IPD leads** → Synced as **pre-admission-stage** patients. They appear in the admission tracker waiting for admission confirmation.
- **Mixed or unclear leads** → Default to opd-stage. Clinical staff can manually change the stage if needed.

### Troubleshooting syncs

1. **Missing leads** — Go to the API Call Log and check the latest sync attempt. If status is "Failed", click the error to see details (e.g., API key expired, LSQ quota exceeded).
2. **Duplicate patients** — If a lead is synced twice, Rounds creates two patient records. Merge them manually via /admin/patients/merge, or contact the LSQ admin to deduplicate in LSQ first.

## Common questions

**Q: How often are leads synced from LSQ?**
A: Depends on your sync method. Webhook = instant (seconds). Polling = every 15 minutes. Manual = only when you click "Sync Now". You can change the sync method anytime from the dashboard.

**Q: What happens if a lead is updated in LSQ after it's synced to Rounds?**
A: If webhook or polling is enabled, the patient record in Rounds updates automatically (e.g., contact details, phone number). Manual sync won't catch updates unless you click "Sync Now" again.

**Q: Can I stop syncing from LSQ?**
A: Yes. Disable webhook sync or disable polling on the /admin/leadsquared dashboard. Already-synced patients stay in Rounds; new leads won't sync. To re-enable, just toggle it back on.

**Q: What custom fields from LSQ come into Rounds?**
A: Standard fields: name, email, phone, lead source (e.g., "website form", "referral", "walk-in"), lead type (OPD or IPD). Custom fields depend on your LSQ configuration. Contact your LSQ admin to see what custom fields exist and which ones should be mapped to Rounds.

**Q: If a patient has both an LSQ record and a manual Rounds record, will they be merged?**
A: Not automatically. Go to /admin/patients and use the "Merge Duplicate Patients" feature to combine records manually. Match by name and contact details.

## Troubleshooting

**Problem: The webhook test fails with "Invalid webhook URL".**
Solution: Verify that you've copied the full URL from the dashboard (it's long and includes a token). Make sure there are no spaces or line breaks. Paste it into LSQ's webhook settings exactly as shown. Test again. If it still fails, check that your firewall allows incoming requests from LSQ's IP range (contact LSQ support for their IP whitelist).

**Problem: Polling is enabled, but no leads have synced in 30 minutes.**
Solution: Check the API Call Log. If the most recent poll shows a failed status, click it to see the error. Common reasons: (1) API key has expired—contact your LSQ admin to rotate it; (2) LSQ account is out of quota—check LSQ billing status; (3) No new leads in LSQ—check the LSQ dashboard directly to confirm leads exist. Try a manual "Sync Now" to force an immediate attempt.

**Problem: A patient synced from LSQ is missing their phone number in Rounds, even though it's in LSQ.**
Solution: Go to the patient's detail page, click "Edit", and manually enter the phone number. This may happen if the LSQ field name doesn't match Rounds' field mapping. Contact your admin to verify field mapping in LSQ integration settings. Once fixed, future syncs will pull the phone number correctly. To re-sync existing records, use the manual "Sync Now" button on the dashboard.
