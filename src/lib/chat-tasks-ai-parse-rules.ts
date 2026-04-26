// ============================================
// Chat Tasks — AI parse rules (CT.9)
//
// PURE CLIENT-SIDE heuristic detector. NO LLM call.
// Flagged off by default (NEXT_PUBLIC_FEATURE_CHAT_TASKS_AI_PARSE_ENABLED).
//
// Detection (all three conditions per PRD §4.4):
//   1) Message contains exactly one @mention.
//   2) Message contains an action verb from ACTION_VERBS.
//   3) (optional) Message contains a time pattern from TIME_PATTERNS.
//
// If 1 + 2 match, prompt the user with "🪄 Make this a task for @alice — '...'".
// Time pattern is OPTIONAL — its absence does not block the prompt.
//
// V1.1 TUNING: edit ACTION_VERBS / TIME_PATTERNS below based on
// telemetry from v1 chat data. This file is the ONE PLACE to change.
// ============================================

/**
 * Action verbs that signal a task. Word-boundary matched, case-insensitive.
 * PRD §4.4 starter list. Tune in v1.1 once we have real chat data — likely
 * additions for EHRC: consent, PAC, discharge, admit, transfer, clear,
 * book, post, wheel, chase, escalate.
 *
 * IMPORTANT: multi-word verbs ("pick up", "follow up") MUST come before
 * their single-word components in the array — the matcher uses Array.find
 * with the literal text, so longer phrases need to win.
 */
export const ACTION_VERBS: readonly string[] = Object.freeze([
  // Multi-word phrases first
  'pick up',
  'follow up',
  // Single-word verbs
  'fetch',
  'verify',
  'confirm',
  'schedule',
  'prepare',
  'submit',
  'call',
  'send',
  'arrange',
  'restock',
  'complete',
]);

/**
 * Time chip patterns. Each entry is a regex + a normalized "chip" label that
 * surfaces in the suggestion prompt. Word-boundary anchored, case-insensitive.
 *
 * The order matters slightly: more specific patterns first (e.g. "by 5pm"
 * before bare "5pm"). The first match wins.
 */
export const TIME_PATTERNS: ReadonlyArray<{ pattern: RegExp; chip: string }> = Object.freeze([
  // "by 5pm", "by 5 pm", "by 17:00"
  { pattern: /\bby\s+(\d{1,2}(:\d{2})?\s*(am|pm))\b/i, chip: 'by $1' },
  { pattern: /\bby\s+(\d{1,2}:\d{2})\b/i, chip: 'by $1' },
  // Standalone time-of-day
  { pattern: /\b(\d{1,2}(:\d{2})?\s*(am|pm))\b/i, chip: '$1' },
  // Date-relative terms
  { pattern: /\bby\s+(today|tomorrow|tonight|EOD|EOW|noon|midnight)\b/i, chip: 'by $1' },
  { pattern: /\b(today|tomorrow|tonight|EOD|EOW)\b/i, chip: '$1' },
  // Hospital-specific (sparse — expand in v1.1)
  { pattern: /\bbefore\s+(discharge|surgery|admission|PAC|round|huddle)\b/i, chip: 'before $1' },
]);

/** Lowered-set for O(1) "is this a verb" check. Built once at module load. */
const ACTION_VERBS_LOWER = new Set(ACTION_VERBS.map((v) => v.toLowerCase()));

/** Mention regex — matches `@<token>` where token is alphanumeric / dot / underscore / hyphen. */
const MENTION_RE = /@([\w.-]+)/g;

export interface ParsedChatTaskIntent {
  /** The single matched @mention's token (without the @). Caller seeds CreateTaskModal's presetAssigneeQuery. */
  mentionToken: string;
  /** The action verb that triggered (lowercase, exact form from ACTION_VERBS). */
  actionVerb: string;
  /** Optional human-readable time chip if a TIME_PATTERN matched. e.g. "by 5pm", "EOD". */
  timeChip: string | null;
  /** Full original message text — caller seeds presetTitle (truncated by modal) + presetDescription. */
  fullText: string;
}

/**
 * Heuristic detector — returns ParsedChatTaskIntent on a 1+2 (and optional 3) match,
 * else null. Pure function, no I/O. Safe to call on every keystroke.
 *
 * Edge cases handled:
 *  - 0 mentions → null (no target)
 *  - 2+ mentions → null (per PRD: exactly one mention)
 *  - "@me" → still triggers — caller decides whether to suppress or self-assign
 *    (CreateTaskModal already self-assigns when no presetAssigneeQuery)
 *  - Empty / whitespace-only text → null
 *  - Verb appears in mention itself (e.g. "@verify-bot ping") → no false positive,
 *    because we strip mentions before scanning for verbs
 */
export function parseChatTaskIntent(text: string): ParsedChatTaskIntent | null {
  if (!text || !text.trim()) return null;

  // 1) Extract mentions.
  const mentions = Array.from(text.matchAll(MENTION_RE));
  if (mentions.length !== 1) return null;
  const mentionToken = mentions[0][1];

  // Strip mentions from the verb-scanning text so "@verify-bot" doesn't false-match "verify".
  const withoutMentions = text.replace(MENTION_RE, ' ');

  // 2) Find an action verb (multi-word first, then single-word; case-insensitive, word-boundary aware).
  const lower = withoutMentions.toLowerCase();
  let actionVerb: string | null = null;
  for (const verb of ACTION_VERBS) {
    // Build a word-boundary-anchored matcher for each verb. Multi-word phrases need
    // \b on both ends; the inner space is treated literally.
    const re = new RegExp(`\\b${verb.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i');
    if (re.test(lower)) {
      actionVerb = verb;
      break;
    }
  }
  if (!actionVerb) return null;

  // 3) Optional time chip.
  let timeChip: string | null = null;
  for (const { pattern, chip } of TIME_PATTERNS) {
    const m = withoutMentions.match(pattern);
    if (m) {
      // Resolve $1 / $2 backrefs against the actual match (basic — not full sprintf).
      timeChip = chip.replace(/\$(\d)/g, (_, n) => m[Number(n)] || '');
      break;
    }
  }

  return {
    mentionToken,
    actionVerb,
    timeChip,
    fullText: text.trim(),
  };
}

/** Internal helper for the unit-test/debug surface — exposed for v1.1 tuning. */
export const _internals = { ACTION_VERBS_LOWER, MENTION_RE };
