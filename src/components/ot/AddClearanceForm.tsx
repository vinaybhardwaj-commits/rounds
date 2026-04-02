'use client';

// ============================================
// AddClearanceForm — Inline specialist clearance add
// Opens below action buttons in SurgeryPanel
// ============================================

import React, { useState, useCallback } from 'react';
import { X } from 'lucide-react';

interface AddClearanceFormProps {
  surgeryPostingId: string;
  onClose: () => void;
  onAdded: () => void;
}

const SPECIALTIES = [
  'Cardiology', 'Nephrology', 'Pulmonology', 'Endocrinology',
  'Neurology', 'Gastroenterology', 'Haematology', 'Rheumatology',
  'Dermatology', 'Ophthalmology', 'Psychiatry',
];

export function AddClearanceForm({ surgeryPostingId, onClose, onAdded }: AddClearanceFormProps) {
  const [specialty, setSpecialty] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!specialty) {
      setError('Please select a specialty');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ot/readiness/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surgery_posting_id: surgeryPostingId,
          item_type: 'specialist_clearance',
          specialty,
          reason: reason || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add clearance');
    } finally {
      setLoading(false);
    }
  }, [specialty, reason, surgeryPostingId, onAdded]);

  return (
    <div className="bg-blue-50 rounded-xl p-3 border border-blue-100 mt-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-blue-800">Add Specialist Clearance</span>
        <button onClick={onClose} className="p-0.5 hover:bg-blue-100 rounded">
          <X size={14} className="text-blue-400" />
        </button>
      </div>
      <div className="space-y-2">
        <select
          value={specialty}
          onChange={e => setSpecialty(e.target.value)}
          className="w-full text-xs border border-blue-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-blue-400"
        >
          <option value="">Select specialty...</option>
          {SPECIALTIES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          type="text"
          placeholder="Reason (e.g. CKD Stage 3, AS Grade II)"
          value={reason}
          onChange={e => setReason(e.target.value)}
          className="w-full text-xs border border-blue-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-blue-400"
        />
        {error && <p className="text-[10px] text-red-600">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="text-xs text-gray-500 px-3 py-1 rounded-lg hover:bg-blue-100" disabled={loading}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !specialty}
            className="text-xs font-medium text-white bg-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Adding...' : 'Add Clearance'}
          </button>
        </div>
      </div>
    </div>
  );
}
