---
feature: direct-messages
title: Direct Messages & Private Conversations
roles: [super_admin, department_head, doctor, surgeon, nurse, anesthesiologist, ot_coordinator, ip_coordinator, billing_executive, insurance_coordinator, pharmacist, physiotherapist, marketing_executive, support_staff]
pages: [/, /chat]
category: communication
related: [chat-messaging]
since: "2026-03-15"
keywords: [DM, direct message, private, mention, @mention, read receipt, checkmark, 1-on-1, personal]
---

## What is this?

Direct messages (DMs) are private 1-on-1 conversations between staff members. Unlike channel messages (which are visible to the whole department or hospital), DMs are only visible to the two people involved. Use DMs for sensitive conversations, quick questions to a colleague, or personal coordination that doesn't need the whole team to see.

Every message in Rounds shows read receipts: a single checkmark means sent, a double checkmark means delivered to the app, and a blue double checkmark means the other person has read it.

## How to use it

### Starting a new DM

1. **Open the chat panel** — Click the "Chat" icon on the left sidebar or go to /chat.
2. **Find the DM section** — In the chat sidebar, look for a "Direct Messages" section (separate from channel list).
3. **Click the + icon** — Next to "Direct Messages", click the plus button. A dropdown opens with a list of all active staff members.
4. **Select a colleague** — Search by name or scroll through and click the person you want to message. Their name appears highlighted.
5. **Start typing** — The chat window opens with that person's name at the top (not a hash symbol like channels). Type your message and press Enter to send.

### Reading & responding to DMs

- DMs appear in the chat sidebar under "Direct Messages" list. Each shows the colleague's name and a preview of the latest message.
- Unread DMs show a blue dot next to the name. Click the DM to open the full conversation.
- Your entire message history with that person is visible. Scroll up to see older messages.
- Click in the message box and type to reply. Press Enter to send.

### Understanding read receipts

- **Single checkmark (✓)** — Message sent from your device to Rounds server. It's on its way.
- **Double checkmark (✓✓)** — Message delivered. The other person's app has received it (but they may not have read it).
- **Blue double checkmark (✓✓)** — Message read. The other person has opened the conversation and seen your message.

Note: If a message shows a single checkmark for a long time and you're on WiFi, your internet connection may be unstable. Check your connection or try sending again.

### Mentioning colleagues with @mention

1. **In any channel or DM**, type @ and a colleague's name (e.g., @Rajesh or @Dr Sharma).
2. A dropdown appears with matching names. Click to select.
3. That person receives a notification: "You were mentioned in [channel/DM]". They'll see the message highlighted in their chat.
4. Use @mention when you need someone's urgent attention or want to clarify who should respond.

### Organizing your DM list

- Pinned DMs: Long-press a DM in the sidebar, select "Pin". It moves to the top of your DM list so you don't lose track of important ongoing conversations.
- Mute DMs: If a DM is too chatty, long-press and select "Mute". You'll still receive messages, but notifications will be silenced.
- Archive: Swipe left on a DM (mobile) or right-click and "Archive" to hide it from your main list. Archived DMs can be restored from /chat settings.

## Common questions

**Q: Can I send a DM to someone who's offline?**
A: Yes. DMs are stored on the server. When they log in next, they'll see your message history and can respond. Read receipts will update once they open the app.

**Q: What if I accidentally start a DM with the wrong person? Can I delete it?**
A: Yes. Right-click the DM in the sidebar (or long-press on mobile) and select "Delete Conversation". This removes it from your sidebar, but the messages are archived on the server for 90 days in case you need them for compliance. The other person's copy is not deleted.

**Q: Can I add more than one person to a DM (like a group chat)?**
A: Not via DM. If you want a 1-to-many conversation, create or join a channel instead (e.g., #surgery-planning). Channels allow multiple people to see and respond to messages.

**Q: I sent a DM but it shows only a single checkmark. Is it stuck?**
A: Single checkmark usually means it's processing (a few seconds delay is normal). If it stays single for more than 5 minutes, try refreshing the page. If it still doesn't update, check your internet connection. If the message eventually fails, you'll see a red X and can retry.

**Q: Can my supervisor see my DMs?**
A: No. DMs are private. Only you and the recipient can see them, even though messages are stored on Rounds servers. Department heads and super_admins cannot view other people's DMs unless there's a legal compliance request (in which case admins have audit access for legal holds).

## Troubleshooting

**Problem: I started a DM but the colleague's name is not showing in my sidebar yet.**
Solution: The DM may not have synced yet. Refresh the page. If they still don't appear, verify they're an active user in /admin/profiles (only active users can receive DMs). They may also have muted or archived DMs—ask them to check their archives if they can't see your message.

**Problem: A colleague says they never received my DM, but I see a blue checkmark (read receipt).**
Solution: A blue checkmark means the message was delivered and the DM was opened. They may have been scrolled to an older part of the conversation and missed your message. Ask them to scroll to the bottom to find your latest message, or send a quick follow-up DM to draw their attention.

**Problem: I'm trying to @mention someone but they're not appearing in the dropdown.**
Solution: That person must be an active user in the system. If they're newly added or still in pending approval, they won't show up in @mention. Contact an admin to verify they're activated. Also, note that @mentions in DMs don't send notifications (they're already notified by the DM itself), so mentions are mainly useful in channels.
