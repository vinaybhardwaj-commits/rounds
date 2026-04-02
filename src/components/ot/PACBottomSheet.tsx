'use client';

// ============================================
// PACBottomSheet — Standalone PAC confirmation
// Reachable from: Surgery Panel, OT Items, /confirm-pac
// ASA score selection, notes, specialist clearances
// ============================================

import React, { useState, useCallback } from 'react';
import { X } from 'lucide-react';
import type { SurgeryPosting, OTReadinessItem } from '@/types';

interface PACBottomSheetProps {
  posting: SurgeryPosting;
  pacItem: OTReadinessItem;
  onClose: () => void;
  onConfirmed: () => void;
}

const ASA_SCORES = [1, 2, 3, 4, 5, 6] as const;

export function PACBottomSheet({ posting, pacItem, onClose, onConfirmed }: PACBottomSheetProps) {
  const [asaScore, setAsaScore] = useState<number | null>(null);
  const [pacNotes, setPacNotes] = useState('');
  const [needsClearance, setNeedsClearance] = useState(false);
  const [clearances, setClearances] = useState<{ specialty: string; reason: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isHighRisk = asaScore !== null && asaScore >= 3;

  const addClearance = () => {
    setClearances(prev => [...prev, { specialty: '', reason: '' }]);
  };

  const updateClearance = (idx: number, field: 'specialty' | 'reason', value: string) => {
    setClearances(prev => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  };

  const removeClearance = (idx: number) => {
    setClearances(prev => prev.filter((_, i) => i !== idx));
  };

  const handleConfirm = useCallback(async () => {
    if (!asaScore) {
      setError('Please select an ASA score');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Confirm PAC readiness item with ASA score
      const res = await fetch(`/api/ot/readiness/${pacItem.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm',
          asa_score: asaScore,
          notes: pacNotes || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      // 2. If high-risk, also update posting
      if (isHighRisk) {
        await fetch(`/api/ot/postings/${posting.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            asa_score: asaScore,
            is_high_risk: true,
            pac_notes: pacNotes || undefined,
          }),
        });
      }

      // 3. Add specialist clearances if any
      for (const clearance of clearances) {
        if (clearance.specialty) {
          await fetch('/api/ot/readiness/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              surgery_posting_id: posting.id,
              item_type: 'specialist_clearance',
              specialty: clearance.specialty,
              reason: clearance.reason || undefined,
            }),
          });
        }
      }

      onConfirmed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm PAC');
    } finally {
      setLoading(false);
    }
  }, [asaScore, pacNotes, isHighRisk, clearances, pacItem.id, posting.id, onConfirmed]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 rounded-t-2xl z-10">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900">Confirm PAC</h3>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full">
              <X size={18} className="text-gray-400" />
            </button>
          </div>
          <div className="mt-1 text-xs text-gray-500">
            <p className="font-medium text-gray-700">{posting.procedure_name}</p>
            <p>Pt: {posting.patient_name} — {posting.primary_surgeon_name} — OT {posting.ot_room}</p>
            <p>
              {posting.scheduled_date}
              {posting.scheduled_time ? `, ${posting.scheduled_time}` : ''}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-5">
          {/* ASA Score */}
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-2">
              ASA Score <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              {ASA_SCORES.map(score => (
                <button
                  key={score}
                  onClick={() => setAsaScore(score)}
                  className={`
                    w-10 h-10 rounded-xl text-sm font-semibold transition-all
                    ${asaScore === score
                      ? score >= 3
                        ? 'bg-red-600 text-white ring-2 ring-red-300'
                        : 'bg-green-600 text-white ring-2 ring-green-300'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }
                  `}
                >
                  {score}
                </button>
              ))}
            </div>
            {isHighRisk && (
              <p className="mt-1.5 text-[11px] font-medium text-red-600 bg-red-50 px-2 py-1 rounded-lg">
                ⚠ High Risk — ASA {asaScore}. Patient will be flagged for enhanced monitoring.
              </p>
            )}
          </div>

          {/* PAC Notes */}
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1.5">PAC Notes</label>
            <textarea
              value={pacNotes}
              onChange={e => setPacNotes(e.target.value)}
              placeholder="Fit for SA. Normal investigations..."
              rows={2}
              className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-blue-300 resize-none"
            />
          </div>

          {/* Specialist Clearances */}
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-2">
              Specialist Clearances Needed?
            </label>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => { setNeedsClearance(false); setClearances([]); }}
                className={`text-xs px-4 py-2 rounded-xl font-medium transition-colors ${
                  !needsClearance ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                No ✓
              </button>
              <button
                onClick={() => { setNeedsClearance(true); if (clearances.length === 0) addClearance(); }}
                className={`text-xs px-4 py-2 rounded-xl font-medium transition-colors ${
                  needsClearance ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Yes
              </button>
            </div>

            {needsClearance && (
              <div className="space-y-2">
                {clearances.map((c, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-gray-50 rounded-xl p-2.5">
                    <select
                      value={c.specialty}
                      onChange={e => updateClearance(idx, 'specialty', e.target.value)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white flex-1 focus:outline-none focus:border-blue-300"
                    >
                      <option value="">Select specialty...</option>
                      <option value="Cardiology">Cardiology</option>
                      <option value="Nephrology">Nephrology</option>
                      <option value="Pulmonology">Pulmonology</option>
                      <option value="Endocrinology">Endocrinology</option>
                      <option value="Neurology">Neurology</option>
                      <option value="Gastroenterology">Gastroenterology</option>
                      <option value="Haematology">Haematology</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Reason (e.g. AS Gr II)"
                      value={c.reason}
                      onChange={e => updateClearance(idx, 'reason', e.target.value)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 flex-1 focus:outline-none focus:border-blue-300"
                    />
                    <button
                      onClick={() => removeClearance(idx)}
                      className="text-gray-400 hover:text-red-500 p-1"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={addClearance}
                  className="text-xs text-blue-600 font-medium hover:text-blue-800 pl-1"
                >
                  + Add Another Clearance
                </button>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-4 flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || !asaScore}
            className="flex-1 py-2.5 text-sm font-semibold text-white bg-green-600 rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            {loading ? 'Confirming...' : 'Confirm PAC'}
          </button>
        </div>
      </div>
    </div>
  );
}
