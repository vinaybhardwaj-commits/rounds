---
feature: escalation-engine
title: Escalation & Alert Management
roles: [super_admin, department_head, doctor, surgeon, nurse, ip_coordinator]
pages: [/admin/escalations, /]
category: operations
related: [duty-roster, ot-surgery-readiness, admission-tracker]
since: "2026-03-15"
keywords: [escalation, overdue, alert, urgent, escalate, chain, level, resolve, late, delay]
---

## What is this?

The escalation engine automatically tracks issues that have become urgent — when readiness items are overdue, tasks are not completed on time, or patients are not progressing as scheduled. It uses a 4-level escalation chain: first the assigned person is reminded, then their department head, then the General Manager, and finally a system-wide alert is sent. Escalated issues appear as red cards in the chat and are also logged in the escalation log for tracking. This ensures nothing falls through the cracks.

## How to use it

1. Escalations happen automatically — you don't need to manually trigger them. The system monitors overdue readiness items and tasks.
2. If you are assigned a readiness item or task, you will see a red card in the chat when it becomes overdue. Complete the item immediately.
3. If a task assigned to someone in your department is overdue, you (the department head) will see a red escalation card in the chat. Contact that person and follow up.
4. If a critical hospital-wide issue is overdue, the General Manager will receive a system alert.
5. To see the full escalation log and history of all escalations, go to Admin → Escalations.
6. In the escalation log, you can see:
   - What issue was escalated (patient name, readiness item, task name)
   - Which level it reached (1=individual, 2=department head, 3=GM, 4=system alert)
   - When it was escalated
   - Whether it has been resolved
7. To resolve an escalation, complete the underlying issue (e.g., finish the readiness item, complete the task). The escalation will automatically be marked resolved and the red card will disappear.

## Common questions

**Q: What is the difference between Level 1 and Level 4 escalations?**
A: Level 1 is the first reminder to the assigned person. Level 2 alerts the department head. Level 3 alerts the GM. Level 4 is a system-wide alert sent to all admins and appears as a critical red banner. The more levels escalated, the more urgent it is.

**Q: How do I stop a red escalation card from appearing in the chat?**
A: Complete the underlying task or readiness item that is overdue. Once completed, the escalation is automatically resolved and the red card disappears. You cannot manually dismiss an escalation without resolving the issue.

**Q: Can I manually escalate something that is not yet overdue?**
A: The current version escalates automatically only when items are overdue. To flag something as urgent before it is due, add a comment in the task or message your team directly in the chat.

**Q: If an escalation reaches Level 4 (GM alert), does that mean the hospital is in crisis?**
A: Not necessarily. It means a critical item has become significantly overdue and needs immediate attention. It is a strong signal to prioritize resolution, but the GM can assess the situation and determine next steps.

**Q: Can I see escalations from the past month in the log?**
A: Yes. Go to Admin → Escalations and the log shows all escalations with date filters. You can filter by date range, status (resolved/unresolved), and department.

## Troubleshooting

**Problem: I received a red escalation card but I believe the item is not actually overdue.**
Solution: Check the due date on the underlying task or readiness item. If the due date was set incorrectly, edit the item to update the due date. Once corrected, the escalation will recalculate. If you believe the escalation is a system error, contact your administrator.

**Problem: An escalation shows as unresolved in the log but I completed the task days ago.**
Solution: The escalation should automatically mark as resolved when you complete the task. If it did not, the task status may not have been properly saved. Open the task, verify it shows as complete, and save it again. Refresh the escalation log to see if it updates.

**Problem: I keep getting escalation notifications about the same item even though someone on the team is working on it.**
Solution: The escalation will continue until the item is actually marked complete. Coordinate with the person working on it — they may need help finishing. If they are blocked, help resolve the blocker so the item can be completed and the escalation will stop.
