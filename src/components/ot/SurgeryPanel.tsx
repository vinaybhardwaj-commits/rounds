'use client';

// ============================================
// SurgeryPanel — Collapsed summary + expanded
// accordion in PatientDetailView. Shows readiness
// donut, personal action line, full checklist,
// equipment, and action buttons (role-gated).
// ============================================

import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronUp, Pencil } from 'lucide-react';
import type { SurgeryPosting, OTReadinessItem, OTEquipmentItem } from '@/types';
import {
  SURGERY_STATUS_LABELS,
  READINESS_STATUS_LABELS,
  READINESS_STATUS_DOT_COLORS,
  WOUND_CLASS_LABELS,
  ANAESTHESIA_TYPE_LABELS,
} from '@/types';
import { ReadinessDonut, toDonutData } from './ReadinessDonut';
import { ReadinessAccordion } from './ReadinessAccordion';
import { EquipmentStatusBadge } from './EquipmentStatusBadge';
import { PACBottomSheet } from './PACBottomSheet';
import { AddClearanceForm } from './AddClearanceForm';
import { AddEquipmentForm } from './AddEquipmentForm';

interface SurgeryPanelProps {
  patientThreadId: string;
  userRole: string;
  userId: string;
}

// Roles allowed to see PAC button
const ANAESTHESIA_ROLES = ['anesthesiologist', 'super_admin'];

export function SurgeryPanel({ patientThreadId, userRole, userId }: SurgeryPanelProps) {
  const [posting, setPosting] = useState<SurgeryPosting | null>(null);
  const [readinessItems, setReadinessItems] = useState<OTReadinessItem[]>([]);
  const [equipmentItems, setEquipmentItems] = useState<OTEquipmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  // Inline form states
  const [showPAC, setShowPAC] = useState(false);
  const [showAddClearance, setShowAddClearance] = useState(false);
  const [showAddEquipment, setShowAddEquipment] = useState(false);

  const fetchPosting = useCallback(async () => {
    try {
      // First get the posting for this patient
      const listRes = await fetch(`/api/ot/postings?patient_thread_id=${patientThreadId}&status=posted`);
      const listData = await listRes.json();
      if (!listData.success || !listData.data || listData.data.length === 0) {
        setPosting(null);
        setLoading(false);
        return;
      }

      // Get the most recent posting
      const latestPosting = listData.data[0];

      // Now get full detail with readiness items
      const detailRes = await fetch(`/api/ot/postings/${latestPosting.id}`);
      const detailData = await detailRes.json();
      if (!detailData.success) {
        setPosting(null);
        setLoading(false);
        return;
      }

      setPosting(detailData.data.posting);
      setReadinessItems(detailData.data.readinessItems || []);
      setEquipmentItems(detailData.data.equipmentItems || []);
    } catch (err) {
      console.error('[SurgeryPanel] fetch error:', err);
      setPosting(null);
    } finally {
      setLoading(false);
    }
  }, [patientThreadId]);

  useEffect(() => {
    fetchPosting();
  }, [fetchPosting]);

  const handleRefresh = useCallback(() => {
    fetchPosting();
  }, [fetchPosting]);

  // Loading state
  if (loading) {
    return (
      <div className="mx-4 mb-4">
        <div className="animate-pulse bg-gray-100 rounded-xl h-20" />
      </div>
    );
  }

  // No posting — empty state
  if (!posting) {
    return (
      <div className="mx-4 mb-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Upcoming Surgery
        </h3>
        <div className="bg-gray-50 rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-xs text-gray-400">
            No surgery posted for this patient.
          </p>
        </div>
      </div>
    );
  }

  // Compute personal action count
  const myPendingItems = readinessItems.filter(
    i => i.status === 'pending' && (i.responsible_role === userRole || i.responsible_user_id === userId)
  );

  const donutData = toDonutData(readinessItems);
  const readinessLabel = READINESS_STATUS_LABELS[posting.overall_readiness as keyof typeof READINESS_STATUS_LABELS] || posting.overall_readiness;
  const readinessDotColor = READINESS_STATUS_DOT_COLORS[posting.overall_readiness as keyof typeof READINESS_STATUS_DOT_COLORS] || '#f59e0b';

  // Find PAC item (if exists and pending)
  const pacItem = readinessItems.find(i => i.item_key === 'pac_cleared' && i.status === 'pending');
  const canConfirmPAC = ANAESTHESIA_ROLES.includes(userRole) && !!pacItem;
  const canAddClearance = ANAESTHESIA_ROLES.includes(userRole);

  const woundClassLabel = posting.wound_class
    ? WOUND_CLASS_LABELS[posting.wound_class as keyof typeof WOUND_CLASS_LABELS] || posting.wound_class
    : null;
  const anaesthesiaLabel = posting.anaesthesia_type
    ? ANAESTHESIA_TYPE_LABELS[posting.anaesthesia_type as keyof typeof ANAESTHESIA_TYPE_LABELS] || posting.anaesthesia_type
    : null;

  return (
    <div className="mx-4 mb-4">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
        Upcoming Surgery
      </h3>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {/* Collapsed summary card — always visible, tap to expand */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-left p-3.5 hover:bg-gray-50/50 transition-colors"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: readinessDotColor }}
                />
                <span className="text-sm font-medium text-gray-900 truncate">
                  {posting.procedure_name}
                </span>
              </div>
              <p className="text-xs text-gray-500 pl-4.5">
                {posting.primary_surgeon_name} — {posting.scheduled_date}
                {posting.scheduled_time ? `, ${posting.scheduled_time}` : ''} OT{posting.ot_room}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-3">
              <ReadinessDonut data={donutData} size={40} strokeWidth={5} showLabel={false} />
              {expanded
                ? <ChevronUp size={16} className="text-gray-400" />
                : <ChevronDown size={16} className="text-gray-400" />
              }
            </div>
          </div>

          {/* Personal action line */}
          {myPendingItems.length > 0 && (
            <div className="mt-2 pl-4.5">
              <span className="text-[11px] font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                ⚡ You: {myPendingItems.length} item{myPendingItems.length !== 1 ? 's' : ''} to confirm
              </span>
            </div>
          )}
          {myPendingItems.length === 0 && readinessItems.length > 0 && (
            <div className="mt-2 pl-4.5">
              <span className="text-[11px] font-medium text-green-600">
                ✓ All your items confirmed
              </span>
            </div>
          )}
        </button>

        {/* Expanded detail */}
        {expanded && (
          <div className="border-t border-gray-100 px-3.5 pt-3 pb-3.5">
            {/* Meta info line */}
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-500 mb-3">
              {woundClassLabel && <span>{woundClassLabel}</span>}
              {anaesthesiaLabel && <span>{anaesthesiaLabel}</span>}
              {posting.case_complexity && <span>{posting.case_complexity}</span>}
              {posting.asa_score && <span>ASA {posting.asa_score}</span>}
              {posting.is_high_risk && (
                <span className="text-red-600 font-medium">High Risk</span>
              )}
              {posting.implant_required && <span>Implant Required</span>}
              {posting.blood_required && <span>Blood Required</span>}
            </div>

            {/* Readiness donut + label */}
            <div className="flex items-center gap-3 mb-3">
              <ReadinessDonut data={donutData} size={48} strokeWidth={6} />
              <span
                className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{ color: readinessDotColor, backgroundColor: `${readinessDotColor}15` }}
              >
                {readinessLabel}
              </span>
            </div>

            {/* Accordion categories */}
            <ReadinessAccordion
              items={readinessItems}
              userRole={userRole}
              userId={userId}
              surgeryPostingId={posting.id}
              onRefresh={handleRefresh}
            />

            {/* Equipment section */}
            {equipmentItems.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Equipment
                </h4>
                <div>
                  {equipmentItems.map(eq => (
                    <EquipmentStatusBadge key={eq.id} equipment={eq} userRole={userRole} />
                  ))}
                </div>
              </div>
            )}

            {/* Action buttons (role-gated) */}
            <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-2">
              {canConfirmPAC && (
                <button
                  onClick={() => setShowPAC(true)}
                  className="text-[11px] font-medium text-green-700 bg-green-50 px-3 py-1.5 rounded-lg hover:bg-green-100 transition-colors"
                >
                  Confirm PAC
                </button>
              )}
              {canAddClearance && (
                <button
                  onClick={() => { setShowAddClearance(true); setShowAddEquipment(false); }}
                  className="text-[11px] font-medium text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  + Clearance
                </button>
              )}
              <button
                onClick={() => { setShowAddEquipment(true); setShowAddClearance(false); }}
                className="text-[11px] font-medium text-purple-700 bg-purple-50 px-3 py-1.5 rounded-lg hover:bg-purple-100 transition-colors"
              >
                + Equipment
              </button>
            </div>

            {/* Inline forms */}
            {showAddClearance && (
              <AddClearanceForm
                surgeryPostingId={posting.id}
                onClose={() => setShowAddClearance(false)}
                onAdded={() => { setShowAddClearance(false); handleRefresh(); }}
              />
            )}
            {showAddEquipment && (
              <AddEquipmentForm
                surgeryPostingId={posting.id}
                onClose={() => setShowAddEquipment(false)}
                onAdded={() => { setShowAddEquipment(false); handleRefresh(); }}
              />
            )}
          </div>
        )}
      </div>

      {/* PAC Bottom Sheet (portal-level) */}
      {showPAC && pacItem && posting && (
        <PACBottomSheet
          posting={posting}
          pacItem={pacItem}
          onClose={() => setShowPAC(false)}
          onConfirmed={() => { setShowPAC(false); handleRefresh(); }}
        />
      )}
    </div>
  );
}
