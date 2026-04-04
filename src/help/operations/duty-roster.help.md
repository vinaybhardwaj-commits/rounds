---
feature: duty-roster
title: Managing Staff Shift Schedules
roles: [super_admin, department_head]
pages: [/admin/duty-roster]
category: operations
related: [escalation-engine]
since: "2026-03-15"
keywords: [duty, roster, shift, schedule, morning, evening, night, handoff, override, staffing]
---

## What is this?

The duty roster is a scheduling tool for managing staff shift assignments across the hospital. You create roster entries to assign staff members to specific departments and shifts (morning, evening, night), choose which days of the week they work, and set effective dates. You can also override shifts for specific dates if there is a change needed. When shifts change, the system automatically posts notifications to the department's chat channel so the team knows about handoffs.

Access it at Admin → Duty Roster.

## How to use it

1. Go to Admin menu and tap "Duty Roster".
2. You will see a calendar view showing all current shift assignments color-coded by shift type.
3. To create a new roster entry, tap the "Add Shift" button.
4. Fill in the following details:
   - **Staff Member**: Select the person from the staff list.
   - **Department**: Choose which department they will work for.
   - **Role**: Select their role (doctor, nurse, coordinator, etc.).
   - **Shift Type**: Choose Morning (e.g., 6am–2pm), Evening (e.g., 2pm–10pm), or Night (e.g., 10pm–6am).
   - **Days of Week**: Select which days (Monday–Sunday) this schedule applies to.
   - **Effective From**: Set the start date for this roster entry.
   - **Effective To**: Set the end date (or leave blank if ongoing).
5. Tap "Save" — the roster is created and a handoff notification is posted to the department channel.
6. To override a single day (e.g., staff member called in sick), tap the specific date on the calendar and create an override entry. The override will replace the regular shift for just that day.
7. To edit an existing roster entry, tap the shift on the calendar and choose "Edit".
8. To view upcoming shifts for a specific person or department, use the filter at the top.

## Common questions

**Q: If I set a shift from Monday to Friday, will the person work every Monday-Friday?**
A: Yes. If you select Monday–Friday and set "Effective From" as April 1, the person will work Monday–Friday starting April 1 until the "Effective To" date (or indefinitely if you leave that blank). To stop the schedule, edit the roster entry and set an "Effective To" date.

**Q: Can I assign one person to multiple shifts on the same day?**
A: No, a person cannot work two shifts on the same day. If you need to change someone's shift, edit the existing roster entry or create an override for that specific date.

**Q: What does an "override" do?**
A: An override replaces the regular shift for a single day only. For example, if a night nurse is normally scheduled Tuesday night but needs to work Wednesday morning instead, create an override for Wednesday morning and the system will use that instead of their normal Tuesday shift.

**Q: When I create a shift, who gets the handoff notification?**
A: The notification is posted to the department's chat channel so all team members see the new shift assignment. The staff member assigned is also notified directly.

**Q: Can I create a recurring shift pattern that doesn't follow Monday–Friday?**
A: The roster allows you to select any combination of days in a week. For example, you could select Monday, Wednesday, Friday for a 3-day pattern. If you need a more complex pattern, contact your system administrator.

## Troubleshooting

**Problem: I created a shift but I don't see it on the calendar.**
Solution: Check the "Effective From" date — if it's set to a future date, the shift will not appear until that date arrives. Also verify that the calendar view is showing the correct date range. Try refreshing the page to reload the calendar.

**Problem: The handoff notification did not post to the department channel.**
Solution: The notification should post automatically, but there may be a delay of a few seconds. Refresh the chat channel to see if it appears. If you still don't see it, contact your system administrator to check if the department channel is correctly configured.

**Problem: I cannot find the staff member I need to assign in the list.**
Solution: The person may not be registered in the system yet or may be marked inactive. Contact your HR or system administrator to ensure the staff member is active in the system. You can only assign people who are already registered.
