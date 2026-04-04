---
feature: daily-briefing
title: AI Morning Briefing
roles: [super_admin, department_head, operations_manager, unit_head, medical_administrator]
pages: [/, /tasks]
category: ai-features
related: [gap-analysis, predictions]
since: 2026-03-15
keywords: [briefing, morning, summary, AI, action items, overdue, admissions, surgeries, discharges, escalations]
---

## What is this?

Every morning, the AI generates a summary of what's happening in the hospital — how many patients were admitted, surgeries scheduled, discharges pending, overdue items, and escalations. It also produces a list of action items ranked by priority. Think of it as your morning newspaper for hospital operations.

## How to use it

1. Tap the **Tasks** tab at the bottom of your screen.
2. The Daily Briefing card appears at the top. It loads automatically.
3. Read the **summary line** for a quick status check.
4. Tap any section (Admissions, Surgeries, Discharges, Overdue Items, Escalations) to expand it and see details.
5. Scroll down to **Action Items** — these are things the AI thinks need your attention today, ranked by priority (red = high, orange = medium, blue = low).
6. To regenerate the briefing with fresh data, tap the **refresh icon** in the top-right corner of the card.

## Common questions

**Q: Why does the briefing say "No data available"?**
The AI needs data to generate a briefing. If no patients have been admitted or no forms submitted recently, the briefing will be empty. This is normal for quiet periods.

**Q: The briefing seems outdated. How do I get a fresh one?**
Tap the refresh icon. The briefing is cached to load fast, so it might show data from earlier in the day. Refreshing forces a new generation.

**Q: Why is the briefing taking a long time to load?**
The AI runs on a local server (not the cloud). If the AI server is busy or restarting, it may take 10-20 seconds. If it takes longer than 30 seconds, the AI server may be down — contact the GM or IT.

**Q: Who can see the briefing?**
Department heads, operations managers, unit heads, and admins. Regular staff don't see the briefing card in their Tasks tab.

**Q: Can I see yesterday's briefing?**
Currently, only today's briefing is shown. Historical briefings are planned for a future update.

## Troubleshooting

**Problem: Briefing shows an error message.**
The AI server (Qwen) may be offline. Check with IT or the GM. The system will show a "LLM unavailable" indicator in red if the AI server can't be reached.

**Problem: Action items don't seem relevant.**
The AI generates action items based on the data it has. If the underlying data (patient records, forms, escalations) is incomplete or incorrect, the briefing will reflect that. Improving data quality improves the briefing.
