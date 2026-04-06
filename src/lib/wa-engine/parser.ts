// ============================================
// WhatsApp Analysis Engine — Chat Parser
// Phase: WA.2
//
// Deterministic regex-based parser for WhatsApp
// .txt exports. Handles both iOS and Android formats.
// ============================================

import { createHash } from 'crypto';
import type { ParsedWhatsAppMessage } from './types';

// ── Format detection ──

type ExportFormat = 'ios' | 'android' | 'unknown';

// iOS: [DD/MM/YY, HH:MM:SS] Sender: Message
const IOS_PATTERN = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2}:\d{2})\]\s+(.+?):\s([\s\S]*)$/;
// Android: DD/MM/YYYY, HH:MM - Sender: Message
const ANDROID_PATTERN = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2})\s+-\s+(.+?):\s([\s\S]*)$/;

// System message patterns (these have no "Sender:" part)
const IOS_SYSTEM_PATTERN = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2}:\d{2})\]\s+(.+)$/;
const ANDROID_SYSTEM_PATTERN = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2})\s+-\s+(.+)$/;

// Timestamp boundary: start of a new message line
const TIMESTAMP_BOUNDARY = /^\[?\d{1,2}\/\d{1,2}\/\d{2,4}[,\s]+\d{1,2}:\d{2}/;

// Known system message indicators
const SYSTEM_INDICATORS = [
  'Messages and calls are end-to-end encrypted',
  'created group',
  'added you',
  'were added',
  'was added',
  'removed you',
  'was removed',
  'left the group',
  'joined using this group',
  'changed the subject',
  'changed this group',
  'changed the group',
  'changed their phone number',
  'security code changed',
  'disappeared',
  'turned on disappearing',
  'turned off disappearing',
  'pinned a message',
  'deleted this group',
  'You joined',
  'This message was deleted',
  'You deleted this message',
  'null',
  '<Media omitted>',
  'image omitted',
  'video omitted',
  'audio omitted',
  'sticker omitted',
  'document omitted',
  'Contact card omitted',
  'GIF omitted',
  'Your security code with',
];

/**
 * Detect the WhatsApp export format from the first few lines.
 */
function detectFormat(content: string): ExportFormat {
  const lines = content.split('\n').slice(0, 20);
  for (const line of lines) {
    if (IOS_PATTERN.test(line) || (IOS_SYSTEM_PATTERN.test(line) && line.startsWith('['))) {
      return 'ios';
    }
    if (ANDROID_PATTERN.test(line) || ANDROID_SYSTEM_PATTERN.test(line)) {
      return 'android';
    }
  }
  return 'unknown';
}

/**
 * Parse a date string from WhatsApp export into a Date object.
 * Handles DD/MM/YY, DD/MM/YYYY with various time formats.
 */
function parseTimestamp(dateStr: string, timeStr: string): Date {
  const [day, month, yearRaw] = dateStr.split('/').map(Number);
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;

  // Time can be HH:MM or HH:MM:SS
  const timeParts = timeStr.split(':').map(Number);
  const hours = timeParts[0];
  const minutes = timeParts[1];
  const seconds = timeParts[2] || 0;

  return new Date(year, month - 1, day, hours, minutes, seconds);
}

/**
 * Check if a message is a system message (not from a user).
 */
function isSystemMessage(sender: string, content: string): boolean {
  // Check known system indicators in content
  for (const indicator of SYSTEM_INDICATORS) {
    if (content.includes(indicator)) return true;
  }
  // System messages sometimes appear with no real sender
  if (!sender || sender.trim() === '') return true;
  return false;
}

/**
 * Compute SHA-256 hash for a parsed message.
 * Formula: sha256(group_name + '|' + sender + '|' + timestamp_iso + '|' + content.trim().substring(0, 200))
 */
function computeHash(groupName: string, sender: string, timestamp: Date, content: string): string {
  const payload = [
    groupName,
    sender,
    timestamp.toISOString(),
    content.trim().substring(0, 200),
  ].join('|');
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Try to extract the group name from the first system message in the export.
 * Falls back to the provided filename-based group name.
 */
function extractGroupName(content: string, fallbackName: string): string {
  const lines = content.split('\n').slice(0, 10);
  for (const line of lines) {
    // iOS: "Messages and calls are end-to-end encrypted..." is followed by
    // "[date] Sender created group "GroupName"" or similar
    const createdMatch = line.match(/created group "(.+?)"/i);
    if (createdMatch) return createdMatch[1];

    // Look for subject line: "changed the subject to "GroupName""
    const subjectMatch = line.match(/changed the subject (?:from .+ )?to "(.+?)"/i);
    if (subjectMatch) return subjectMatch[1];
  }

  // Fallback: try to extract from filename
  // Common pattern: "WhatsApp Chat with GroupName.txt"
  const filenameMatch = fallbackName.match(/WhatsApp Chat with (.+?)\.txt$/i);
  if (filenameMatch) return filenameMatch[1];

  // Use filename without extension
  return fallbackName.replace(/\.txt$/i, '');
}

/**
 * Split the raw export into logical message blocks.
 * Multi-line messages are merged with their first line.
 */
function splitIntoBlocks(content: string): { text: string; lineNumber: number }[] {
  const lines = content.split('\n');
  const blocks: { text: string; lineNumber: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;

    if (TIMESTAMP_BOUNDARY.test(line)) {
      // Start of a new message
      blocks.push({ text: line, lineNumber: i + 1 });
    } else if (blocks.length > 0) {
      // Continuation of previous message (multi-line)
      blocks[blocks.length - 1].text += '\n' + line;
    }
    // Lines before the first timestamp are ignored (BOM, empty, etc.)
  }

  return blocks;
}

/**
 * Parse a single message block into a structured message.
 */
function parseBlock(
  block: string,
  lineNumber: number,
  format: ExportFormat,
  groupName: string,
): ParsedWhatsAppMessage | null {
  let match: RegExpMatchArray | null = null;
  let sender = '';
  let dateStr = '';
  let timeStr = '';
  let content = '';
  let sysMessage = false;

  if (format === 'ios') {
    match = block.match(IOS_PATTERN);
    if (match) {
      dateStr = match[1];
      timeStr = match[2];
      sender = match[3].trim();
      content = match[4];
    } else {
      // Try system message pattern (no sender:content split)
      const sysMatch = block.match(IOS_SYSTEM_PATTERN);
      if (sysMatch) {
        dateStr = sysMatch[1];
        timeStr = sysMatch[2];
        content = sysMatch[3];
        sender = '';
        sysMessage = true;
      }
    }
  } else if (format === 'android') {
    match = block.match(ANDROID_PATTERN);
    if (match) {
      dateStr = match[1];
      timeStr = match[2];
      sender = match[3].trim();
      content = match[4];
    } else {
      const sysMatch = block.match(ANDROID_SYSTEM_PATTERN);
      if (sysMatch) {
        dateStr = sysMatch[1];
        timeStr = sysMatch[2];
        content = sysMatch[3];
        sender = '';
        sysMessage = true;
      }
    }
  }

  if (!dateStr || !timeStr) return null; // Could not parse

  const timestamp = parseTimestamp(dateStr, timeStr);
  if (isNaN(timestamp.getTime())) return null; // Invalid date

  // Check for system message even if we parsed sender
  if (!sysMessage && isSystemMessage(sender, content)) {
    sysMessage = true;
  }

  const hash = computeHash(groupName, sender, timestamp, content);

  return {
    sender,
    timestamp,
    content: content.trim(),
    group_name: groupName,
    is_system_message: sysMessage,
    hash,
    line_number: lineNumber,
  };
}

/**
 * Parse a raw WhatsApp .txt export into structured messages.
 *
 * @param content - Raw text content of the WhatsApp export file
 * @param filenameOrGroup - Original filename or group name (used as fallback for group identification)
 * @returns Array of parsed messages (including system messages, marked accordingly)
 */
export function parseWhatsAppExport(
  content: string,
  filenameOrGroup: string,
): ParsedWhatsAppMessage[] {
  if (!content || content.trim().length === 0) return [];

  // Strip BOM if present
  const cleaned = content.replace(/^\uFEFF/, '');

  // Detect format
  const format = detectFormat(cleaned);
  if (format === 'unknown') {
    throw new Error(
      'Unrecognized WhatsApp export format. Expected iOS format ([DD/MM/YY, HH:MM:SS] Sender: Message) ' +
      'or Android format (DD/MM/YYYY, HH:MM - Sender: Message).'
    );
  }

  // Extract group name
  const groupName = extractGroupName(cleaned, filenameOrGroup);

  // Split into message blocks
  const blocks = splitIntoBlocks(cleaned);

  // Parse each block
  const messages: ParsedWhatsAppMessage[] = [];
  for (const block of blocks) {
    const msg = parseBlock(block.text, block.lineNumber, format, groupName);
    if (msg) messages.push(msg);
  }

  return messages;
}

/**
 * Utility: compute a SHA-256 hash for a message (exposed for dedup module).
 */
export function hashMessage(
  groupName: string,
  sender: string,
  timestamp: Date,
  content: string,
): string {
  return computeHash(groupName, sender, timestamp, content);
}
