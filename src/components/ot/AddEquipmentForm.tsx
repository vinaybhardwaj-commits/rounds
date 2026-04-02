'use client';

// ============================================
// AddEquipmentForm — Inline equipment add
// Opens below action buttons in SurgeryPanel
// ============================================

import React, { useState, useCallback } from 'react';
import { X } from 'lucide-react';

interface AddEquipmentFormProps {
  surgeryPostingId: string;
  onClose: () => void;
  onAdded: () => void;
}

const EQUIPMENT_TYPES = [
  { value: 'implant', label: 'Implant' },
  { value: 'instrument', label: 'Instrument' },
  { value: 'consumable', label: 'Consumable' },
  { value: 'rental_equipment', label: 'Rental Equipment' },
  { value: 'other', label: 'Other' },
];

export function AddEquipmentForm({ surgeryPostingId, onClose, onAdded }: AddEquipmentFormProps) {
  const [itemType, setItemType] = useState('implant');
  const [itemName, setItemName] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [isRental, setIsRental] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!itemName.trim()) {
      setError('Please enter an item name');
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
          item_type: 'equipment',
          equipment: {
            item_type: itemType,
            item_name: itemName.trim(),
            vendor_name: vendorName.trim() || undefined,
            is_rental: isRental,
            quantity,
          },
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add equipment');
    } finally {
      setLoading(false);
    }
  }, [itemType, itemName, vendorName, isRental, quantity, surgeryPostingId, onAdded]);

  return (
    <div className="bg-purple-50 rounded-xl p-3 border border-purple-100 mt-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-purple-800">Add Equipment / Implant</span>
        <button onClick={onClose} className="p-0.5 hover:bg-purple-100 rounded">
          <X size={14} className="text-purple-400" />
        </button>
      </div>
      <div className="space-y-2">
        <div className="flex gap-2">
          <select
            value={itemType}
            onChange={e => setItemType(e.target.value)}
            className="text-xs border border-purple-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-purple-400"
          >
            {EQUIPMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input
            type="number"
            min={1}
            max={99}
            value={quantity}
            onChange={e => setQuantity(parseInt(e.target.value) || 1)}
            className="w-14 text-xs text-center border border-purple-200 rounded-lg px-1 py-1.5 bg-white focus:outline-none focus:border-purple-400"
          />
        </div>
        <input
          type="text"
          placeholder="Item name (e.g. BHR Size 50, C-Arm)"
          value={itemName}
          onChange={e => setItemName(e.target.value)}
          className="w-full text-xs border border-purple-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-purple-400"
        />
        <input
          type="text"
          placeholder="Vendor name (optional)"
          value={vendorName}
          onChange={e => setVendorName(e.target.value)}
          className="w-full text-xs border border-purple-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-purple-400"
        />
        <label className="flex items-center gap-2 text-xs text-purple-700">
          <input
            type="checkbox"
            checked={isRental}
            onChange={e => setIsRental(e.target.checked)}
            className="rounded border-purple-300"
          />
          Rental equipment
        </label>
        {error && <p className="text-[10px] text-red-600">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="text-xs text-gray-500 px-3 py-1 rounded-lg hover:bg-purple-100" disabled={loading}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !itemName.trim()}
            className="text-xs font-medium text-white bg-purple-600 px-3 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            {loading ? 'Adding...' : 'Add Equipment'}
          </button>
        </div>
      </div>
    </div>
  );
}
