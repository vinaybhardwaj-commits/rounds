---
feature: chat-messaging
title: Sending and Reading Chat Messages
roles: [staff, department_head, super_admin, ip_coordinator, nurse, billing_executive, insurance_coordinator, pharmacist, ot_coordinator, anesthesiologist, marketing_executive, clinical_care, pac_coordinator, operations_manager, unit_head, medical_administrator, administrator]
pages: [/, /chat]
category: communication
related: [message-types, patient-threads]
since: 2026-03-01
keywords: [message, send, chat, DM, direct message, channel, thread, reply, mention, notification]
---

## What is this?

Rounds Chat is the hospital's internal messaging system. It works like WhatsApp but is organized around patients and departments. Every message is structured with a type (Request, Update, Escalation, etc.) so people can quickly scan what needs attention.

## How to use it

1. Tap the **Chat** tab at the bottom of your screen.
2. On the left, you'll see your channels — these are group conversations organized by department, patient, or topic.
3. Tap a channel to open it. Messages appear on the right.
4. To send a message, type in the box at the bottom and tap the blue send button.
5. Before sending, you can set a **message type** using the dropdown above the text box. Choose "Request" if you need something, "Escalation" if it's urgent, "FYI" for information only, or just leave it as "Chat" for normal conversation.
6. To reply to a specific message, tap the reply icon on that message. This opens a thread so the conversation stays organized.
7. To send a file or image, tap the paperclip icon next to the text box.

## Common questions

**Q: How do I send a direct message to one person?**
Tap the "New Message" button (pencil icon) at the top of the channel list. Search for the person by name and start typing.

**Q: What do the colored badges on messages mean?**
Blue = Request (someone needs something from you). Green = Update (status information). Red = Escalation (urgent, needs immediate attention). Orange = Decision Needed. Gray = FYI. Purple = Patient Lead.

**Q: How do I find an old message?**
Tap the search icon at the top of the chat screen. Type keywords from the message. You can also search within a specific channel.

**Q: Can I delete a message I sent by mistake?**
Yes. Long-press (or right-click on desktop) the message and choose "Delete." You'll need to select a reason. Deleted messages are logged for audit purposes.

**Q: I'm not seeing messages from a channel. What's wrong?**
You may not be a member of that channel. Ask your department head or admin to add you. Some channels are restricted to specific roles.

## Troubleshooting

**Problem: Messages aren't sending.**
Check your internet connection. If you see a red error bar at the top, the chat server may be temporarily unavailable. Wait a moment and try again.

**Problem: I can't see the chat tab.**
Make sure you're logged in. If your account is pending approval, you won't have access to chat until an admin approves you.

## Recent updates (April 2026)

**Per-hospital broadcast channels (MH.5):** the channel sidebar now has separate Broadcast rows per accessible hospital — "EHRC · Broadcast" and "EHBR · Broadcast" (only if you have access to EHBR). System messages like SLA breach alerts post to the relevant hospital's broadcast channel. Hospital-bound users see only their hospital's broadcast row. The legacy single "hospital-broadcast" channel is renamed to "Broadcast (legacy)" — it's kept for back-compat but new alerts go to the per-hospital channels.

**Channel naming with -ehrc/-ehbr suffix (Sprint 2):** department channels are now named with their hospital suffix (e.g. `marketing-ehrc`, `nursing-ehbr`, `ot-ehrc`). The sidebar groups them under "EHRC · Departments" and "EHBR · Departments" rows. Hospital-bound users see only their hospital's department channels.

**ChannelSidebar splits by hospital_slug:** every channel type that has a `hospital_slug` in its data is auto-split into per-hospital rows. Cross-functional channels (Marketing, Central Broadcast, OT Schedule, etc.) stay un-suffixed since they span all hospitals.

**Hospital tenancy via channel membership:** you can only see channels you're a member of (GetStream enforces). Server seeds department + broadcast channels with the right staff per hospital. Cross-hospital filtering is automatic — no client-side gate needed.

**Chat tasks (separate feature):** any chat message can be turned into a tracked actionable task with assignee + due date + status lifecycle. Tap the "+" icon on a message or use the `/task` slash command. See *chat-tasks*.

**HospitalChip on Recent Submissions rows:** when you open the Forms tab from the chat sidebar's quick search, recent form submissions now show a HospitalChip per row. Multi-hospital users get visual disambiguation; hospital-bound users see the chip as a visual confirm.
