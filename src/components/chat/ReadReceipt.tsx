'use client';

// ============================================
// ReadReceipt — WhatsApp-style checkmarks
// ✓  = Sent (message exists)
// ✓✓ = Read by at least one other member
// ✓✓ (blue) = Read by ALL members in channel
// ============================================

import React from 'react';
import { Check, CheckCheck } from 'lucide-react';

export type ReadStatus = 'sent' | 'read' | 'read_all';

interface ReadReceiptProps {
  status: ReadStatus;
  className?: string;
}

/**
 * Compact checkmark indicator for message delivery/read state.
 *
 * - sent:     Single grey check (✓)
 * - read:     Double grey check (✓✓) — at least one person read
 * - read_all: Double blue check (✓✓) — everyone in the channel read
 */
export function ReadReceipt({ status, className = '' }: ReadReceiptProps) {
  if (status === 'sent') {
    return (
      <Check
        size={14}
        className={`inline-block text-gray-400 ${className}`}
        aria-label="Sent"
      />
    );
  }

  if (status === 'read') {
    return (
      <CheckCheck
        size={14}
        className={`inline-block text-gray-400 ${className}`}
        aria-label="Read"
      />
    );
  }

  // read_all — blue double check
  return (
    <CheckCheck
      size={14}
      className={`inline-block text-blue-500 ${className}`}
      aria-label="Read by everyone"
    />
  );
}

/**
 * Compute read status for a message by comparing channel.state.read
 * against the message timestamp.
 *
 * @param messageCreatedAt  ISO timestamp of the message
 * @param channelRead       channel.state.read — map of userId → { last_read }
 * @param senderId          the user who sent the message
 * @param totalMembers      total member count in the channel
 */
export function computeReadStatus(
  messageCreatedAt: string,
  channelRead: Record<string, { last_read?: string | Date; user?: { id?: string } }> | undefined,
  senderId: string,
  totalMembers: number
): ReadStatus {
  if (!channelRead || totalMembers <= 1) {
    return 'sent';
  }

  const msgTime = new Date(messageCreatedAt).getTime();
  let readCount = 0;
  // Count of members who are NOT the sender
  let otherMemberCount = 0;

  for (const [userId, readState] of Object.entries(channelRead)) {
    // Skip the sender's own read state
    if (userId === senderId) continue;

    otherMemberCount++;

    if (readState.last_read) {
      const lastRead = new Date(readState.last_read).getTime();
      if (lastRead >= msgTime) {
        readCount++;
      }
    }
  }

  // Edge case: if there are no other members tracked in read state
  if (otherMemberCount === 0) return 'sent';

  if (readCount >= otherMemberCount) return 'read_all';
  if (readCount > 0) return 'read';
  return 'sent';
}
