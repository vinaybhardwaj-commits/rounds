'use client';

// ============================================
// EquipmentStatusBadge — Role-aware display
// SCM roles see full vendor/ETA detail.
// Other roles see simplified colored dots.
// ============================================

import React from 'react';
import type { OTEquipmentItem, OTEquipmentStatus } from '@/types';
import { OT_EQUIPMENT_STATUS_LABELS, OT_EQUIPMENT_STATUS_COLORS, OT_EQUIPMENT_SIMPLE_STATUS } from '@/types';

interface EquipmentStatusBadgeProps {
  equipment: OTEquipmentItem;
  userRole: string;
}

const SCM_ROLES = ['supply_chain', 'super_admin'];

function getDotClass(status: string): string {
  const simpleEntry = OT_EQUIPMENT_SIMPLE_STATUS[status as OTEquipmentStatus];
  if (!simpleEntry) return 'bg-amber-500';
  const emoji = simpleEntry.color;
  if (emoji === '🟢') return 'bg-green-500';
  if (emoji === '🔴') return 'bg-red-500';
  if (emoji === '⚪') return 'bg-gray-300';
  return 'bg-amber-500'; // 🟡 default
}

export function EquipmentStatusBadge({ equipment, userRole }: EquipmentStatusBadgeProps) {
  const isScm = SCM_ROLES.includes(userRole);
  const status = equipment.status as OTEquipmentStatus;
  const label = OT_EQUIPMENT_STATUS_LABELS[status] || equipment.status;
  const colorClass = OT_EQUIPMENT_STATUS_COLORS[status] || 'text-gray-500';
  const dotClass = getDotClass(equipment.status);

  if (!isScm) {
    // Simplified view: dot + name
    return (
      <div className="flex items-center gap-2 py-1.5">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotClass}`} />
        <span className="text-xs text-gray-700 truncate">{equipment.item_name}</span>
        {equipment.quantity > 1 && (
          <span className="text-[10px] text-gray-400">&times;{equipment.quantity}</span>
        )}
      </div>
    );
  }

  // Full SCM view: name, vendor, status, ETA
  return (
    <div className="py-2 border-b border-gray-50 last:border-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotClass}`} />
          <span className="text-xs font-medium text-gray-800 truncate">{equipment.item_name}</span>
          {equipment.quantity > 1 && (
            <span className="text-[10px] text-gray-400">&times;{equipment.quantity}</span>
          )}
        </div>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ml-2 ${colorClass}`}>
          {label}
        </span>
      </div>
      <div className="ml-[18px] mt-0.5 text-[10px] text-gray-400 space-x-3">
        {equipment.vendor_name && <span>{equipment.vendor_name}</span>}
        {equipment.is_rental && <span className="text-amber-500">Rental</span>}
        {equipment.delivery_eta && (
          <span>ETA: {new Date(equipment.delivery_eta).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        )}
        {equipment.vendor_contact && <span>Tel: {equipment.vendor_contact}</span>}
      </div>
      {equipment.status_notes && (
        <p className="ml-[18px] mt-0.5 text-[10px] text-gray-400 italic">{equipment.status_notes}</p>
      )}
    </div>
  );
}
