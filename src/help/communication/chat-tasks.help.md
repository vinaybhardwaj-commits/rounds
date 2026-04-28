---
feature: chat-tasks
title: Chat Tasks (Assign actionable to-dos in chat)
roles: [super_admin, hospital_admin, department_head, doctor, surgeon, nurse, anesthesiologist, ot_coordinator, ip_coordinator, billing_executive, insurance_coordinator, pharmacist, physiotherapist, marketing_executive, support_staff]
pages: [/chat, /chat-tasks]
category: communication
related: [chat-messaging, direct-messages, escalation-engine]
since: "2026-04-15"
keywords: [task, assign, todo, chat task, status, pending, in progress, complete, cancel, acknowledge, due, priority, message, reaction, ping]
---

## What is this?

Chat tasks turn a chat message into a tracked actionable item with an assignee, due date, and status lifecycle. Useful when a request can't be handled inline ("Can you grab the form 8 from Pharmacy by 5pm?") and needs accountability.

A task has:
- **Title** (required)
- **Description** (optional)
- **Assignee** (required — can be self-assigned)
- **Patient** (auto-set if you create the task in a patient channel; otherwise optional)
- **Due date/time** (optional)
- **Priority** (low / medium / high / urgent)
- **Status:** `pending` → `acknowledged` → `in_progress` → `complete` (or `cancelled` at any point)
- **Source message** (the chat message the task came from, if any)

Every task lives on `/chat-tasks` (the central task list, scoped to your accessible hospitals) AND surfaces in the chat where it was created (with status pill that updates live).

## How to use it

**Creating a task from chat:**
1. In any chat channel (patient thread, department, direct message), tap the "+" icon on a message OR use the `/task` slash command.
2. The "New chat task" modal opens with the source message linked.
3. Fill in:
   - **Title**: short imperative ("Pick up form 8 from Pharmacy")
   - **Description** (optional): more context
   - **Assignee**: type a name to search the staff directory. Auto-fills to yourself if you don't pick anyone.
   - **Due**: optional date/time picker
   - **Priority**: pick from the 4-level dropdown
4. Submit. The task appears as a status pill on the source message + as a row on `/chat-tasks`.

**Viewing your tasks:**
1. Open `/chat-tasks` (or tap "Tasks" tab in the bottom nav, with a red badge showing pending count).
2. The list shows your assigned tasks first, then tasks you created (assigned to others).
3. Filter by status (pending / acknowledged / in_progress / complete / cancelled), priority, hospital, or due-date range.
4. Tap a task to open its detail view with the source message + comments + status history.

**Updating task status (assignee):**
1. Open the task (from `/chat-tasks` or the chat pill).
2. Tap a status button:
   - **Acknowledge** — you've seen it, will act on it (but haven't started yet)
   - **Start** — you're working on it now
   - **Complete** — done
   - **Cancel** — won't do (with reason)
3. Status updates post a system message back to the source channel so the requester sees progress live.

**Patient context auto-link:**

If you create a task inside a patient chat channel (channel type = `patient-thread`), the task auto-links to that patient. Hospital tenancy is also derived — if the patient belongs to EHBR, the task is filed under EHBR. You don't need to pick the hospital.

## Common questions

**Q: How is a chat task different from a regular chat message?**
A: A message is a one-shot notification with no tracking. A task has an explicit owner, a status, and shows up on `/chat-tasks` until completed. Use messages for FYIs, tasks for "someone needs to do something specific by a specific time."

**Q: Can I assign a task to multiple people?**
A: No — one assignee per task. If you need a group action, create one task per person, or use a department channel for a fan-out request without tracking.

**Q: I assigned a task to someone but they never acknowledged it. How do I escalate?**
A: Tap the task → "Reassign" to send it to someone else, or post a follow-up message in the source channel pinging them. The escalation engine (separate feature) auto-pings overdue tasks but only on critical workflows.

**Q: Can the assignee delegate the task to someone else?**
A: Not directly — only the creator or a super_admin can reassign. If the assignee can't do it, they should ping the creator to reassign.

**Q: What's the difference between Acknowledged and In Progress?**
A: Acknowledged = "I see this and will do it." In Progress = "I'm working on it right now." The two-step pattern lets the creator know you've at least seen it before you actually start. For quick tasks, just go straight to In Progress or Complete.

**Q: Do tasks have a due-date alarm?**
A: Soft: tasks past their due date show in red on `/chat-tasks` and appear at the top of the list. There's no push notification yet — that's on the v1.1 roadmap.

**Q: Can I create a task without a chat message?**
A: Yes — open `/chat-tasks` → tap "+ New task" (top-right). The task won't have a `source_message_id` (the field is optional) but otherwise works the same.

## Troubleshooting

**Problem: I created a task but it doesn't show up on /chat-tasks.**
Solution: Refresh the page. If still missing, the task may have been filed under a hospital you can't see (e.g. if you're hospital-bound but the task got auto-routed to another hospital via patient context). Check with the task creator.

**Problem: I tapped "Complete" but the task is still showing as Pending.**
Solution: Network hiccup. Refresh — your status update should have persisted. If it didn't, the task may be stuck in a state transition; ping the creator and have them manually re-set it.

**Problem: I assigned a task but the system message in the channel says "Task assigned to (unknown user)".**
Solution: The assignee's profile lookup failed. They may have been suspended or deleted. Open the task → reassign to a valid user.

**Problem: I'm getting "Rate limited" when I try to create many tasks fast.**
Solution: There's a rate limit (429) to prevent runaway task creation. Wait the seconds shown in the error and retry.

## Edge cases

- **Task in a patient channel for a patient at a different hospital:** the system uses the patient's `hospital_id` (not your channel's). If you're hospital-bound and the patient is at another hospital, the task creation will 403 unless you have access.
- **Source message deleted after task creation:** the task survives. The "source message" link will show "(message deleted)" but the task itself is intact.
- **Task assignee gets suspended:** the task remains assigned but the assignee can no longer act on it. Reassign manually.
- **Self-assigned tasks:** allowed. Useful as a personal to-do list scoped to a patient or workflow.
- **Bulk-task creation:** not currently supported via UI. If you need to fan out 10+ tasks, use a script via the API (super_admin only).
