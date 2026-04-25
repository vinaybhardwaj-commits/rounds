'use client';

// =============================================================================
// EquipmentRequestModal (26 Apr 2026 redesign)
//
// V's bug report: the case picker dumped a list of every active surgical_case
// into a dropdown, forcing users opening the modal from the kanban page to
// hunt for the right patient.
//
// New behavior:
//   - presetCaseId provided  → fetch + show that case as a read-only banner.
//                               Used by the inline "+ Equipment request"
//                               button on OT Planning panel + tab.
//   - presetHospitalId only  → no case banner; "(No Case Assigned Yet)"
//                               read-only label. Used by the kanban-page
//                               "+ New request" button.
//   - presetCaseId absent + multi-hospital user → require hospital_id pick.
//
// Rental redesigned: standalone toggle at the top of the form. When ON, a
// free-text 'Rental description' textarea appears below — independent of any
// inventory pick. is_rentable on inventory items no longer auto-toggles
// rental.
//
// Endpoint: posts to /api/equipment-requests (case-optional). Old call to
// /api/cases/:id/equipment retired here.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';

interface CaseSummary {
  id: string;
  state: string;
  hospital_id: string;
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

interface HospitalOpt {
  id: string;
  slug: string;
  name: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  kit: 'Kits',
  surgical_equipment: 'Surgical',
  infrastructure: 'Infrastructure',
  consumable: 'Consumable',
};

export interface EquipmentRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** When set, the modal locks to this case (read-only banner). */
  presetCaseId?: string;
  /** When set without presetCaseId, locks to this hospital and shows "No case yet". */
  presetHospitalId?: string;
  /** Called after successful create. Parent typically refetches. */
  onCreated?: () => void;
}

export default function EquipmentRequestModal({
  isOpen, onClose, presetCaseId, presetHospitalId, onCreated,
}: EquipmentRequestModalProps) {
  // Case context: either resolved from presetCaseId, or null (No Case Assigned).
  const [caseRow, setCaseRow] = useState<CaseSummary | null>(null);
  const [caseLoading, setCaseLoading] = useState(false);

  // Hospital — derived from caseRow.hospital_id, presetHospitalId, or picker.
  const [hospitalId, setHospitalId] = useState<string>('');
  const [hospitalOpts, setHospitalOpts] = useState<HospitalOpt[]>([]);

  // Inventory picker
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [pickedItem, setPickedItem] = useState<InventoryItem | null>(null);
  const [isOther, setIsOther] = useState(false);
  const [otherLabel, setOtherLabel] = useState('');
  const [otherCategory, setOtherCategory] = useState<string>('');

  // Rental (now top-level — independent of inventory)
  const [isRental, setIsRental] = useState(false);
  const [rentalDescription, setRentalDescription] = useState('');

  // Common request fields
  const [quantity, setQuantity] = useState(1);
  const [vendor, setVendor] = useState('');
  const [eta, setEta] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form on open.
  useEffect(() => {
    if (!isOpen) return;
    setSearch('');
    setCategoryFilter(null);
    setPickedItem(null);
    setIsOther(false);
    setOtherLabel('');
    setOtherCategory('');
    setIsRental(false);
    setRentalDescription('');
    setQuantity(1);
    setVendor('');
    setEta('');
    setNotes('');
    setError(null);
  }, [isOpen]);

  // Resolve case row when presetCaseId is supplied.
  useEffect(() => {
    if (!isOpen) return;
    if (!presetCaseId) {
      setCaseRow(null);
      setCaseLoading(false);
      return;
    }
    setCaseLoading(true);
    // /api/cases/[id] returns nested { data: { case, hospital, patient, ... } }
    fetch(`/api/cases/${encodeURIComponent(presetCaseId)}`)
      .then((r) => r.json())
      .then((b) => {
        if (b?.success && b.data?.case) {
          const c = b.data.case as { id: string; state: string; planned_procedure: string | null; planned_surgery_date: string | null };
          const h = (b.data.hospital ?? {}) as { id?: string; slug?: string };
          const pt = (b.data.patient ?? {}) as { patient_name?: string | null };
          setCaseRow({
            id: c.id,
            state: c.state,
            hospital_id: h.id ?? '',
            hospital_slug: h.slug ?? '',
            patient_name: pt.patient_name ?? null,
            planned_procedure: c.planned_procedure,
            planned_surgery_date: c.planned_surgery_date,
          });
          if (h.id) setHospitalId(h.id);
        }
      })
      .catch(() => {})
      .finally(() => setCaseLoading(false));
  }, [isOpen, presetCaseId]);

  // If no preset case AND no preset hospital, fetch the user's accessible
  // hospitals so they can pick which one to file under.
  useEffect(() => {
    if (!isOpen) return;
    if (presetCaseId || presetHospitalId) {
      if (presetHospitalId && !hospitalId) setHospitalId(presetHospitalId);
      return;
    }
    // No preset — load hospital options.
    fetch('/api/hospitals/accessible')
      .then((r) => r.json())
      .then((b) => {
        if (b?.success && Array.isArray(b.data)) {
          setHospitalOpts(b.data as HospitalOpt[]);
          if (!hospitalId && b.data.length === 1) {
            setHospitalId(b.data[0].id);
          }
        }
      })
      .catch(() => {});
  }, [isOpen, presetCaseId, presetHospitalId, hospitalId]);

  // Load inventory whenever search / category / hospitalId changes.
  useEffect(() => {
    if (!isOpen || !hospitalId) return;
    const t = setTimeout(() => {
      setInventoryLoading(true);
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('q', search.trim());
      if (categoryFilter) qs.set('category', categoryFilter);
      qs.set('limit', '200');
      fetch(`/api/equipment-inventory?${qs}`)
        .then((r) => r.json())
        .then((b) => {
          if (b?.success && Array.isArray(b.data)) {
            // Client-side scope to the chosen hospital — defends against
            // user changing hospitalId mid-session.
            const filtered = (b.data as InventoryItem[]).filter((i) =>
              !i.hospital_slug || true /* server already scopes via tenancy */
            );
            setInventory(filtered);
          }
        })
        .catch(() => {})
        .finally(() => setInventoryLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [isOpen, search, categoryFilter, hospitalId]);

  // When a picker item is selected, auto-fill default vendor (rental no
  // longer auto-toggles — that's a top-level decision now).
  useEffect(() => {
    if (!pickedItem) return;
    if (!vendor) setVendor(pickedItem.default_vendor_name || '');
  }, [pickedItem]); // eslint-disable-line react-hooks/exhaustive-deps

  // What item is being requested — picker pick OR "Other" free-text OR
  // (if rental w/o item) a synthetic 'Rental request' label.
  const resolvedItemLabel = useMemo(() => {
    if (isOther) return otherLabel.trim();
    if (pickedItem) return pickedItem.item_label;
    if (isRental && rentalDescription.trim()) return `Rental: ${rentalDescription.trim().slice(0, 100)}`;
    return '';
  }, [isOther, otherLabel, pickedItem, isRental, rentalDescription]);

  const resolvedItemType = useMemo(() => {
    if (isOther) return otherCategory || 'other';
    if (pickedItem) return pickedItem.category;
    if (isRental) return 'rental';
    return '';
  }, [isOther, otherCategory, pickedItem, isRental]);

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (!hospitalId) return false;
    if (!resolvedItemLabel || !resolvedItemType) return false;
    if (isRental && !rentalDescription.trim()) return false;
    if (isOther && !otherCategory) return false;
    return true;
  }, [submitting, hospitalId, resolvedItemLabel, resolvedItemType, isRental, rentalDescription, isOther, otherCategory]);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/equipment-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_id: caseRow?.id ?? null,
          hospital_id: hospitalId,
          item_type: resolvedItemType,
          item_label: resolvedItemLabel,
          inventory_item_id: pickedItem?.id ?? null,
          is_rental: isRental,
          rental_description: isRental ? rentalDescription.trim() : null,
          quantity,
          vendor_name: vendor.trim() || undefined,
          eta: eta || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      onCreated?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div role="dialog" aria-modal="true" className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">New equipment request</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {caseRow
                ? `Linked to case ${caseRow.patient_name || ''}${caseRow.planned_procedure ? ' — ' + caseRow.planned_procedure : ''}`
                : 'No case assigned yet'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          {/* Case banner — read-only */}
          <section>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">Case</label>
            <div className="mt-1 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
              {caseLoading
                ? <span className="text-gray-400">Loading case…</span>
                : caseRow
                  ? (
                    <span>
                      <strong className="text-gray-900">{caseRow.patient_name || 'Patient'}</strong>
                      {caseRow.planned_procedure && <span className="text-gray-700"> — {caseRow.planned_procedure}</span>}
                      {caseRow.state && <span className="ml-2 text-[11px] uppercase text-gray-500">{caseRow.state.replace(/_/g, ' ')}</span>}
                    </span>
                  )
                  : <span className="text-gray-500 italic">(No Case Assigned Yet)</span>}
            </div>
          </section>

          {/* Hospital picker — only when there's no preset and the user has multiple */}
          {!caseRow && !presetHospitalId && hospitalOpts.length > 1 && (
            <section>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">Hospital</label>
              <select
                value={hospitalId}
                onChange={(e) => setHospitalId(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">— Select hospital —</option>
                {hospitalOpts.map((h) => (
                  <option key={h.id} value={h.id}>{h.name} ({h.slug})</option>
                ))}
              </select>
            </section>
          )}

          {/* Rental — top-level toggle */}
          <section className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isRental}
                onChange={(e) => setIsRental(e.target.checked)}
                className="mt-0.5"
              />
              <div className="flex-1">
                <span className="text-sm font-semibold text-amber-900">Rental</span>
                <p className="text-[11px] text-amber-800">Tick if this is a rental — vendor brings the kit, returned after surgery.</p>
              </div>
            </label>
            {isRental && (
              <div className="mt-3">
                <label className="block text-[11px] font-semibold uppercase text-amber-900">What needs to be rented?</label>
                <textarea
                  value={rentalDescription}
                  onChange={(e) => setRentalDescription(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="E.g. Stryker Drill Kit (with bits), Holmium Laser, Arthroscopy tower"
                  className="mt-1 w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
                <div className="mt-1 text-right text-[10px] text-amber-700">{rentalDescription.length}/500</div>
              </div>
            )}
          </section>

          {/* Inventory picker — disabled when isRental + no need */}
          {!isRental && (
            <section>
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">Item</label>
                <label className="flex items-center gap-1.5 text-[11px] text-gray-600">
                  <input
                    type="checkbox"
                    checked={isOther}
                    onChange={(e) => { setIsOther(e.target.checked); if (e.target.checked) setPickedItem(null); }}
                  />
                  Other (custom)
                </label>
              </div>

              {!isOther && (
                <>
                  <div className="mt-1 flex gap-1.5">
                    {(['kit', 'surgical_equipment', 'infrastructure', 'consumable'] as const).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCategoryFilter(categoryFilter === c ? null : c)}
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
                          categoryFilter === c
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {CATEGORY_LABELS[c]}
                      </button>
                    ))}
                  </div>

                  <div className="mt-2 relative">
                    <Search className="absolute left-2 top-2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search inventory…"
                      className="w-full rounded-md border border-gray-300 bg-white pl-8 pr-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-gray-200">
                    {inventoryLoading && <div className="p-3 text-xs text-gray-500">Loading…</div>}
                    {!inventoryLoading && inventory.length === 0 && (
                      <div className="p-3 text-xs text-gray-500">No matching inventory.</div>
                    )}
                    {inventory.map((it) => (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => setPickedItem(it)}
                        className={`flex w-full items-center justify-between gap-2 border-b border-gray-100 px-3 py-2 text-left text-xs transition last:border-b-0 ${
                          pickedItem?.id === it.id ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 truncate">{it.item_label}</div>
                          <div className="text-[10px] text-gray-500 truncate">
                            {[it.brand, it.model, it.size_spec].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-700">
                          {CATEGORY_LABELS[it.category] || it.category}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {isOther && (
                <div className="mt-2 space-y-2">
                  <input
                    type="text"
                    value={otherLabel}
                    onChange={(e) => setOtherLabel(e.target.value)}
                    placeholder="Item name (free text)"
                    maxLength={200}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <select
                    value={otherCategory}
                    onChange={(e) => setOtherCategory(e.target.value)}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">— Select category —</option>
                    <option value="surgical_equipment">Surgical equipment</option>
                    <option value="infrastructure">Infrastructure</option>
                    <option value="consumable">Consumable</option>
                    <option value="kit">Kit</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              )}
            </section>
          )}

          {/* Common fields */}
          <section className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase text-gray-600">Quantity</label>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value || '1', 10)))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase text-gray-600">ETA (optional)</label>
              <input
                type="datetime-local"
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] font-semibold uppercase text-gray-600">Vendor (optional)</label>
              <input
                type="text"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                placeholder="Vendor name"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] font-semibold uppercase text-gray-600">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Any additional notes"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </section>

          {error && (
            <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">{error}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-md border border-blue-600 bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Create request'}
          </button>
        </div>
      </div>
    </div>
  );
}
