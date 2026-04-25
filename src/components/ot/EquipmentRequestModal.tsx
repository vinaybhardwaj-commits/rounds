'use client';

// =============================================================================
// EquipmentRequestModal (25 Apr 2026)
//
// Lets a biomedical engineer / OT coordinator / super_admin create a new
// equipment request for a case from the kanban page or CaseDrawer Track 3.
//
// Picker is searchable + category-chip-filtered against /api/equipment-inventory.
// 'Other' option reveals a free-text label field for ad-hoc requests.
//
// On submit: POST /api/cases/:id/equipment with inventory_item_id (or null for
// freetext), is_rental, vendor, qty, ETA, notes. Status starts at 'requested'
// — the kanban handles status moves separately.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';

interface Case {
  id: string;
  state: string;
  hospital_slug: string;
  patient_name: string | null;
  planned_procedure: string | null;
  planned_surgery_date: string | null;
}

interface InventoryItem {
  id: string;
  hospital_slug: string | null;
  category: string;
  subcategory: string | null;
  item_label: string;
  brand: string | null;
  model: string | null;
  size_spec: string | null;
  is_rentable: boolean;
  default_vendor_name: string | null;
  default_vendor_phone: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  kit: 'Kits',
  surgical_equipment: 'Surgical',
  infrastructure: 'Infrastructure',
  consumable: 'Consumable',
};
const CATEGORY_TONES: Record<string, string> = {
  kit: 'bg-purple-100 text-purple-800 border-purple-200',
  surgical_equipment: 'bg-blue-100 text-blue-800 border-blue-200',
  infrastructure: 'bg-amber-100 text-amber-800 border-amber-200',
  consumable: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

export interface EquipmentRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** When set, the case picker is hidden and this case is used. */
  presetCaseId?: string;
  /** Called after successful create. Parent typically refetches. */
  onCreated?: () => void;
}

export default function EquipmentRequestModal({
  isOpen, onClose, presetCaseId, onCreated,
}: EquipmentRequestModalProps) {
  const [cases, setCases] = useState<Case[]>([]);
  const [caseId, setCaseId] = useState<string>('');
  const [casesLoading, setCasesLoading] = useState(false);

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [pickedItem, setPickedItem] = useState<InventoryItem | null>(null);
  const [isOther, setIsOther] = useState(false);
  const [otherLabel, setOtherLabel] = useState('');
  const [otherCategory, setOtherCategory] = useState('surgical_equipment');

  const [isRental, setIsRental] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [vendor, setVendor] = useState('');
  const [eta, setEta] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on open
  useEffect(() => {
    if (!isOpen) return;
    setCaseId(presetCaseId || '');
    setSearch('');
    setCategoryFilter(null);
    setPickedItem(null);
    setIsOther(false);
    setOtherLabel('');
    setIsRental(false);
    setQuantity(1);
    setVendor('');
    setEta('');
    setNotes('');
    setError(null);
  }, [isOpen, presetCaseId]);

  // Load active cases (only when no preset)
  useEffect(() => {
    if (!isOpen || presetCaseId) return;
    setCasesLoading(true);
    fetch('/api/cases?limit=200')
      .then((r) => r.json())
      .then((b) => {
        if (b?.success && Array.isArray(b.data)) setCases(b.data as Case[]);
      })
      .catch(() => {})
      .finally(() => setCasesLoading(false));
  }, [isOpen, presetCaseId]);

  // Load inventory when search or category changes (debounced).
  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => {
      setInventoryLoading(true);
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('q', search.trim());
      if (categoryFilter) qs.set('category', categoryFilter);
      qs.set('limit', '200');
      fetch(`/api/equipment-inventory?${qs}`)
        .then((r) => r.json())
        .then((b) => {
          if (b?.success && Array.isArray(b.data)) setInventory(b.data as InventoryItem[]);
        })
        .catch(() => {})
        .finally(() => setInventoryLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [isOpen, search, categoryFilter]);

  // When a picker item is selected, auto-fill vendor + is_rental defaults.
  useEffect(() => {
    if (!pickedItem) return;
    setVendor(pickedItem.default_vendor_name || '');
    setIsRental(pickedItem.is_rentable);  // default to rental if rentable
  }, [pickedItem]);

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (!caseId) return false;
    if (isOther) return otherLabel.trim().length > 0;
    return !!pickedItem;
  }, [submitting, caseId, isOther, otherLabel, pickedItem]);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const itemLabel = isOther ? otherLabel.trim() : (pickedItem?.item_label ?? '');
    const itemType = isOther
      ? otherCategory
      : (pickedItem?.category ?? 'other');
    const inventoryItemId = isOther ? null : (pickedItem?.id ?? null);
    try {
      const res = await fetch(`/api/cases/${caseId}/equipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_type: itemType,
          item_label: itemLabel,
          inventory_item_id: inventoryItemId,
          is_rental: isRental,
          quantity,
          vendor_name: vendor.trim() || undefined,
          eta: eta || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      onCreated?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const filteredInventory = inventory; // server already filters

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div role="dialog" aria-modal="true" className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">New equipment request</h2>
            <p className="mt-0.5 text-xs text-gray-500">Adds a card to the kanban in &lsquo;requested&rsquo; status.</p>
          </div>
          <button onClick={onClose} disabled={submitting} className="rounded-md p-1 text-gray-500 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {!presetCaseId && (
            <div>
              <label className="block text-sm font-medium text-gray-800">Case <span className="text-red-500">*</span></label>
              <select
                value={caseId}
                onChange={(e) => setCaseId(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                disabled={casesLoading}
              >
                <option value="">{casesLoading ? 'Loading cases…' : '— Select a case —'}</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.patient_name || '(no name)'} · {c.planned_procedure || c.state} · {c.hospital_slug.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-800">Equipment <span className="text-red-500">*</span></label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(['kit','surgical_equipment','infrastructure','consumable'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                    categoryFilter === cat
                      ? CATEGORY_TONES[cat]
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
              <button
                type="button"
                onClick={() => { setIsOther(true); setPickedItem(null); }}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                  isOther
                    ? 'border-gray-400 bg-gray-100 text-gray-800'
                    : 'border-dashed border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Other (free text)
              </button>
            </div>

            {!isOther && (
              <>
                <div className="mt-2 relative">
                  <Search size={14} className="pointer-events-none absolute left-2 top-2.5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search by name, brand, model…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-md border border-gray-300 py-2 pl-7 pr-3 text-sm"
                  />
                </div>
                <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-gray-200">
                  {inventoryLoading && filteredInventory.length === 0 ? (
                    <p className="px-3 py-4 text-xs text-gray-500">Loading…</p>
                  ) : filteredInventory.length === 0 ? (
                    <p className="px-3 py-4 text-xs text-gray-500">
                      {search.trim() ? 'No matches. Try a different search or pick Other.' : 'No items in this category yet.'}
                    </p>
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {filteredInventory.map((it) => {
                        const picked = pickedItem?.id === it.id;
                        const tone = CATEGORY_TONES[it.category] || 'bg-gray-100 text-gray-700';
                        return (
                          <li
                            key={it.id}
                            onClick={() => setPickedItem(it)}
                            className={`cursor-pointer px-3 py-2 text-sm hover:bg-blue-50/60 ${picked ? 'bg-blue-50' : ''}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-medium text-gray-900 truncate">{it.item_label}</span>
                                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>
                                    {CATEGORY_LABELS[it.category] || it.category}
                                  </span>
                                  {it.is_rentable && (
                                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-100">
                                      rentable
                                    </span>
                                  )}
                                </div>
                                {(it.brand || it.size_spec || it.subcategory) && (
                                  <p className="text-[11px] text-gray-500 mt-0.5">
                                    {[it.subcategory, it.brand, it.size_spec].filter(Boolean).join(' · ')}
                                  </p>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </>
            )}

            {isOther && (
              <div className="mt-2 space-y-2">
                <input
                  type="text"
                  placeholder="Type the equipment name"
                  value={otherLabel}
                  onChange={(e) => setOtherLabel(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
                <select
                  value={otherCategory}
                  onChange={(e) => setOtherCategory(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="surgical_equipment">Category: Surgical</option>
                  <option value="infrastructure">Category: Infrastructure</option>
                  <option value="consumable">Category: Consumable</option>
                  <option value="kit">Category: Kit</option>
                </select>
                <button
                  type="button"
                  onClick={() => setIsOther(false)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  ← Back to picker
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isRental}
                onChange={(e) => setIsRental(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span className="text-gray-800">Request as rental</span>
            </label>
            <div>
              <label className="block text-xs font-medium text-gray-700">Quantity</label>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700">Vendor</label>
              <input
                type="text"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                placeholder={pickedItem?.default_vendor_name || 'Vendor name (optional)'}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">ETA</label>
              <input
                type="datetime-local"
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Specific size/model, urgency, etc."
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Add to Requested'}
          </button>
        </div>
      </div>
    </div>
  );
}
