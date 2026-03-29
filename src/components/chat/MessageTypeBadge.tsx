'use client';

// ============================================
// MessageTypeBadge — color-coded label for
// message types (request, update, escalation, etc.)
// ============================================

import React from 'react';
import { MESSAGE_TYPE_COLORS, MESSAGE_TYPE_LABELS } from '@/types';
import type { MessageType } from '@/types';

interface MessageTypeBadgeProps {
  type: MessageType;
  size?: 'sm' | 'md';
}

export function MessageTypeBadge({ type, size = 'sm' }: MessageTypeBadgeProps) {
  // Don't show badge for regular chat messages
  if (type === 'chat' || type === 'general') return null;

  const color = MESSAGE_TYPE_COLORS[type] || '#6B7280';
  const label = MESSAGE_TYPE_LABELS[type] || type;

  return (
    <span
      className={`
        inline-flex items-center font-semibold uppercase tracking-wide rounded-full
        ${size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1'}
      `}
      style={{ backgroundColor: color, color: '#fff' }}
    >
      {label}
    </span>
  );
}
