// ============================================
// OT Surgery Readiness — Readiness Template
// 22 conditional items generated at posting time
// ============================================

import type { SurgeryPosting, OTReadinessCategory } from '@/types';

export interface ReadinessTemplateItem {
  item_key: string;
  item_label: string;
  item_category: OTReadinessCategory;
  responsible_role: string;
  sort_order: number;
  /** Return true if this item should be generated for the given posting */
  condition?: (posting: SurgeryPosting) => boolean;
  /** Hours before scheduled surgery time that this item is due */
  due_offset_hours: number;
}

export const OT_READINESS_TEMPLATE: ReadinessTemplateItem[] = [
  // === CLINICAL ===
  {
    item_key: 'pac_cleared',
    item_label: 'PAC Completed & Clearance Given',
    item_category: 'clinical',
    responsible_role: 'anesthesiologist',
    sort_order: 1,
    condition: (p) => p.anaesthesia_type !== 'LA',
    due_offset_hours: 12,
  },
  {
    item_key: 'investigations_complete',
    item_label: 'All Pre-Op Investigations Complete & Reviewed',
    item_category: 'clinical',
    responsible_role: 'anesthesiologist',
    sort_order: 2,
    due_offset_hours: 12,
  },
  {
    item_key: 'surgical_consent',
    item_label: 'Surgical Consent Signed',
    item_category: 'clinical',
    responsible_role: 'surgeon',
    sort_order: 4,
    due_offset_hours: 4,
  },
  {
    item_key: 'high_risk_consent',
    item_label: 'High-Risk Consent Signed',
    item_category: 'clinical',
    responsible_role: 'surgeon',
    sort_order: 5,
    condition: (p) => p.case_complexity === 'Major' || p.case_complexity === 'Super-Major',
    due_offset_hours: 4,
  },
  {
    item_key: 'site_marking',
    item_label: 'Surgical Site Marked',
    item_category: 'clinical',
    responsible_role: 'surgeon',
    sort_order: 6,
    condition: (p) => p.procedure_side !== 'N/A' && p.procedure_side !== 'Midline',
    due_offset_hours: 2,
  },

  // === FINANCIAL ===
  {
    item_key: 'billing_clearance',
    item_label: 'Billing / Pre-Auth Clearance Confirmed',
    item_category: 'financial',
    responsible_role: 'billing_executive',
    sort_order: 10,
    condition: (p) => p.is_insured === true,
    due_offset_hours: 12,
  },
  {
    item_key: 'deposit_confirmed',
    item_label: 'Deposit Collected / Waiver Approved',
    item_category: 'financial',
    responsible_role: 'billing_executive',
    sort_order: 11,
    due_offset_hours: 12,
  },

  // === LOGISTICS ===
  {
    item_key: 'cssd_instruments',
    item_label: 'CSSD Instruments Ready',
    item_category: 'logistics',
    responsible_role: 'ot_coordinator',
    sort_order: 20,
    due_offset_hours: 4,
  },
  {
    item_key: 'ot_equipment_ready',
    item_label: 'OT Equipment Ready (C-Arm, MindRay, Scope, etc.)',
    item_category: 'logistics',
    responsible_role: 'ot_coordinator',
    sort_order: 21,
    due_offset_hours: 4,
  },
  {
    item_key: 'implant_available',
    item_label: 'Implant Available & Verified in OT',
    item_category: 'logistics',
    responsible_role: 'supply_chain',
    sort_order: 22,
    condition: (p) => p.implant_required === true,
    due_offset_hours: 12,
  },
  {
    item_key: 'consumables_available',
    item_label: 'Consumables Available',
    item_category: 'logistics',
    responsible_role: 'ot_coordinator',
    sort_order: 23,
    due_offset_hours: 4,
  },
  {
    item_key: 'blood_available',
    item_label: 'Blood Products Available',
    item_category: 'logistics',
    responsible_role: 'lab',
    sort_order: 24,
    condition: (p) => p.blood_required === true,
    due_offset_hours: 4,
  },
  {
    item_key: 'pharmacy_ready',
    item_label: 'Pharmacy Ready (Pre-Op + OT Medications)',
    item_category: 'logistics',
    responsible_role: 'pharmacist',
    sort_order: 25,
    due_offset_hours: 4,
  },

  // === NURSING ===
  {
    item_key: 'patient_nbm',
    item_label: 'Patient NBM Confirmed',
    item_category: 'nursing',
    responsible_role: 'nurse',
    sort_order: 30,
    due_offset_hours: 2,
  },
  {
    item_key: 'pre_medication',
    item_label: 'Pre-Medication Administered',
    item_category: 'nursing',
    responsible_role: 'nurse',
    sort_order: 31,
    due_offset_hours: 2,
  },
  {
    item_key: 'part_preparation',
    item_label: 'Part Preparation Completed',
    item_category: 'nursing',
    responsible_role: 'nurse',
    sort_order: 32,
    due_offset_hours: 2,
  },
  {
    item_key: 'nursing_preop_checklist',
    item_label: 'Pre-Operative Nursing Checklist Done',
    item_category: 'nursing',
    responsible_role: 'nurse',
    sort_order: 33,
    due_offset_hours: 2,
  },
  {
    item_key: 'icu_bed_booked',
    item_label: 'ICU Bed Booked & Confirmed',
    item_category: 'nursing',
    responsible_role: 'ip_coordinator',
    sort_order: 34,
    condition: (p) => p.icu_bed_required === true,
    due_offset_hours: 4,
  },

  // === TEAM ===
  {
    item_key: 'surgeon_confirmed',
    item_label: 'Surgeon Availability Confirmed',
    item_category: 'team',
    responsible_role: 'ip_coordinator',
    sort_order: 40,
    due_offset_hours: 12,
  },
  {
    item_key: 'anaesthetist_confirmed',
    item_label: 'Anaesthesiologist Availability Confirmed',
    item_category: 'team',
    responsible_role: 'ip_coordinator',
    sort_order: 41,
    due_offset_hours: 12,
  },
  {
    item_key: 'ot_team_assigned',
    item_label: 'OT Team Assigned (Scrub + Circulating + Tech)',
    item_category: 'team',
    responsible_role: 'ot_coordinator',
    sort_order: 42,
    due_offset_hours: 4,
  },
];

/**
 * Generate readiness items for a surgery posting based on the template.
 * Evaluates conditions and computes due_by from scheduled date/time.
 */
export function generateReadinessItems(
  posting: SurgeryPosting,
  surgeryPostingId: string
): Array<{
  surgery_posting_id: string;
  item_key: string;
  item_label: string;
  item_category: string;
  responsible_role: string;
  sort_order: number;
  is_dynamic: boolean;
  due_by: string | null;
}> {
  const items: ReturnType<typeof generateReadinessItems> = [];

  // Compute base datetime for due_by calculation
  // If no time set, assume 08:00 AM
  // scheduled_date from Postgres may be YYYY-MM-DD or full ISO timestamp
  const rawDate = posting.scheduled_date;
  const dateStr = typeof rawDate === 'string' && rawDate.length > 10
    ? rawDate.slice(0, 10)
    : String(rawDate).slice(0, 10);
  // scheduled_time may be HH:MM or HH:MM:SS — normalize to HH:MM
  const rawTime = posting.scheduled_time || '08:00';
  const timeStr = rawTime.length > 5 ? rawTime.slice(0, 5) : rawTime;
  const baseDate = new Date(`${dateStr}T${timeStr}:00+05:30`); // IST

  for (const tmpl of OT_READINESS_TEMPLATE) {
    // Skip if condition fails
    if (tmpl.condition && !tmpl.condition(posting)) continue;

    // Compute due_by
    const dueDate = new Date(baseDate.getTime() - tmpl.due_offset_hours * 60 * 60 * 1000);

    items.push({
      surgery_posting_id: surgeryPostingId,
      item_key: tmpl.item_key,
      item_label: tmpl.item_label,
      item_category: tmpl.item_category,
      responsible_role: tmpl.responsible_role,
      sort_order: tmpl.sort_order,
      is_dynamic: false,
      due_by: dueDate.toISOString(),
    });
  }

  return items;
}
