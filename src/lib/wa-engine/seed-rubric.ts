// ============================================
// WhatsApp Analysis Engine — Rubric Seed
// Converts the EHRC WhatsApp Chat Analysis Rubric
// into wa_rubric database rows.
//
// Run via: npx tsx src/lib/wa-engine/seed-rubric.ts
// Idempotent: uses ON CONFLICT (slug) DO UPDATE
// ============================================

import { neon } from '@neondatabase/serverless';

// Lazy init — only fails when actually called, not at import time
let _sql: ReturnType<typeof neon> | null = null;
function getSql() {
  if (!_sql) {
    const url = process.env.POSTGRES_URL;
    if (!url) throw new Error('POSTGRES_URL environment variable is required');
    _sql = neon(url);
  }
  return _sql;
}

// Tagged template wrapper so `sql\`...\`` still works
const sql = (strings: TemplateStringsArray, ...values: unknown[]) => getSql()(strings, ...values);

// ── Department rubric data (extracted from EHRC-WhatsApp-Chat-Analysis-Rubric.md) ──

interface RubricField {
  label: string;
  type: 'number' | 'text';
  extraction_hint: string;
  is_signature_kpi: boolean;
  added_by: 'seed' | 'evolution';
  added_at: string;
}

interface DepartmentSeed {
  slug: string;
  name: string;
  keywords: string[];
  fields: RubricField[];
  signature_kpi: string;
}

const SEED_DATE = '2026-04-06';

const DEPARTMENTS: DepartmentSeed[] = [
  {
    slug: 'emergency',
    name: 'Emergency',
    keywords: ['ED', 'emergency', 'ER', 'triage', 'walk-in', 'ambulance', 'code blue', 'code red', 'code yellow', 'LAMA', 'DAMA', 'MLC', 'door-to-doctor'],
    signature_kpi: '# of ER cases',
    fields: [
      { label: '# of genuine walk-in/ambulance emergencies (last 24h)', type: 'number', extraction_hint: 'Counts of walk-ins, ambulance cases, ER visits', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of after-hours planned admissions routed through ED', type: 'number', extraction_hint: 'Planned patients coming through ED at night', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Door-to-doctor TAT emergencies only (avg minutes)', type: 'number', extraction_hint: 'Wait time mentions, TAT', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of patients LWBS', type: 'number', extraction_hint: 'Left without being seen', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of Deaths', type: 'number', extraction_hint: 'Any death reported', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of MLC cases registered', type: 'number', extraction_hint: 'Medico-legal cases', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Triage L1 + L2 count', type: 'number', extraction_hint: 'Critical/emergent triage counts', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'ED revenue today (Rs.)', type: 'number', extraction_hint: 'ED revenue figure', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of LAMA/DAMA', type: 'number', extraction_hint: 'Patients leaving against advice', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of Critical alerts (Code Blue/Red/Yellow)', type: 'number', extraction_hint: 'Code alerts', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of ED incident reports', type: 'number', extraction_hint: 'Incident reports filed', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of ER cases', type: 'number', extraction_hint: 'Total ER cases', is_signature_kpi: true, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of Admissions/Transfers', type: 'number', extraction_hint: 'Admissions from ED', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Anticipated challenges/other notes', type: 'text', extraction_hint: 'Free text about upcoming issues', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
    ],
  },
  {
    slug: 'customer-care',
    name: 'Customer Care',
    keywords: ['complaint', 'escalation', 'front desk', 'reception', 'OPD appointment', 'no-show', 'Google review', 'testimonial', 'call centre', 'waiting time', 'doctor late', 'doctor delay'],
    signature_kpi: 'Pending Complaints',
    fields: [
      { label: '# of OPD appointments — in-person', type: 'number', extraction_hint: 'In-person appointment counts', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of OPD appointments — tele', type: 'number', extraction_hint: 'Teleconsult counts', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of OPD no-shows', type: 'number', extraction_hint: 'Patients who booked but didn\'t show', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of patients who left OPD without being seen', type: 'number', extraction_hint: 'Gave up waiting', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of patients waiting > 10 min in OPD', type: 'number', extraction_hint: 'Long wait complaints', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of Health check appointments', type: 'number', extraction_hint: 'Health check bookings', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of new complaints received today', type: 'number', extraction_hint: 'New complaints mentioned', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of complaints closed / resolved today', type: 'number', extraction_hint: 'Resolved complaints', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of total complaints currently pending resolution', type: 'number', extraction_hint: 'Pending complaint count', is_signature_kpi: true, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Age of oldest open complaint (days)', type: 'number', extraction_hint: 'Oldest complaint age', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of customer escalations', type: 'number', extraction_hint: 'Escalations to management', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Doctors on leave today', type: 'text', extraction_hint: 'Names of doctors on leave', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Doctors late > 10 min', type: 'text', extraction_hint: 'Names of late doctors', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of patients affected by doctor delays', type: 'number', extraction_hint: 'Patients impacted by lateness', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of Google Reviews received today', type: 'number', extraction_hint: 'Google review count', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Average star rating of new Google Reviews', type: 'number', extraction_hint: 'Star rating (1-5)', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of Video Testimonials collected', type: 'number', extraction_hint: 'Testimonials collected', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
    ],
  },
  {
    slug: 'patient-safety',
    name: 'Patient Safety & Quality',
    keywords: ['incident', 'near-miss', 'adverse event', 'sentinel', 'patient fall', 'medication error', 'RCA', 'NABH', 'audit', 'compliance', 'HAI', 'bundle', 'CLABSI', 'CAUTI', 'VAP', 'SSI', 'safety briefing'],
    signature_kpi: 'Adverse Events',
    fields: [
      { label: '# of Near-miss incidents reported today', type: 'number', extraction_hint: 'Near-miss mentions', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of Adverse events reported today', type: 'number', extraction_hint: 'Adverse events', is_signature_kpi: true, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of Sentinel events reported today', type: 'number', extraction_hint: 'Sentinel events (serious harm)', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of Patient falls today', type: 'number', extraction_hint: 'Patient falls', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of Medication errors today', type: 'number', extraction_hint: 'Medication errors', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Under-reporting flag', type: 'text', extraction_hint: 'Suspicion of unreported incidents', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of open RCAs currently in progress', type: 'number', extraction_hint: 'Open root cause analyses', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of open RCAs past their due date', type: 'number', extraction_hint: 'Overdue RCAs', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of corrective actions closed today', type: 'number', extraction_hint: 'Corrective actions completed', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'RCA summary', type: 'text', extraction_hint: 'Any RCA initiated/closed details', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Central Line bundle compliance today', type: 'text', extraction_hint: 'CLABSI prevention status', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Urinary Catheter bundle compliance today', type: 'text', extraction_hint: 'CAUTI prevention status', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Ventilator bundle compliance today', type: 'text', extraction_hint: 'VAP prevention status', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Surgical site care bundle compliance today', type: 'text', extraction_hint: 'SSI prevention status', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of new NABH non-compliances identified today', type: 'number', extraction_hint: 'New NABH issues', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of NABH non-compliances closed today', type: 'number', extraction_hint: 'NABH issues resolved', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of total open NABH non-compliances', type: 'number', extraction_hint: 'Running NABH total', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of open audit findings past their due date', type: 'number', extraction_hint: 'Overdue audit findings', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of staff who received a safety briefing', type: 'number', extraction_hint: 'Safety communication count', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Topic of safety communication today', type: 'text', extraction_hint: 'Safety topic discussed', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
    ],
  },
  {
    slug: 'finance',
    name: 'Finance',
    keywords: ['revenue', 'MTD', 'ARPOB', 'census', 'IP patient', 'midnight census', 'OPD revenue', 'surgeries MTD', 'revenue leakage'],
    signature_kpi: 'Revenue MTD',
    fields: [
      { label: 'Revenue for the day (Rs.)', type: 'number', extraction_hint: 'Daily revenue (Indian rupees)', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Total revenue MTD (Rs.)', type: 'number', extraction_hint: 'Month-to-date revenue', is_signature_kpi: true, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Midnight census — total IP patients', type: 'number', extraction_hint: 'IP patient count at midnight', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Surgeries MTD', type: 'number', extraction_hint: 'Month-to-date surgeries', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'ARPOB — Avg Revenue Per Occupied Bed (Rs.)', type: 'number', extraction_hint: 'ARPOB value', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'OPD revenue MTD (Rs.)', type: 'number', extraction_hint: 'OPD month-to-date revenue', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Revenue leakage alerts', type: 'text', extraction_hint: 'Revenue leakage mentions', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
    ],
  },
  {
    slug: 'billing',
    name: 'Billing',
    keywords: ['pipeline', 'billing clearance', 'DAMA', 'LAMA', 'financial counselling', 'interim counselling', 'ICU census', 'NICU'],
    signature_kpi: 'Pipeline Cases',
    fields: [
      { label: '# of Pipeline cases (active, pending billing)', type: 'number', extraction_hint: 'Pending billing cases', is_signature_kpi: true, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of OT cases with billing clearance pending', type: 'number', extraction_hint: 'OT billing backlog', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of DAMA / LAMA', type: 'number', extraction_hint: 'DAMA/LAMA from billing perspective', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of Financial counselling sessions done today', type: 'number', extraction_hint: 'Counselling sessions', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of Interim financial counselling done', type: 'number', extraction_hint: 'Interim counselling', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'ICU / NICU census', type: 'number', extraction_hint: 'ICU/NICU patient count', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Surgeries planned for next day', type: 'text', extraction_hint: 'Upcoming surgery list', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'High-risk patient alerts', type: 'text', extraction_hint: 'High-risk patient mentions', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
    ],
  },
  {
    slug: 'supply-chain',
    name: 'Supply Chain & Procurement',
    keywords: ['GRN', 'PO', 'purchase order', 'procurement', 'stock availability', 'shortage', 'backorder', 'stockout', 'emergency purchase', 'after 5pm purchase', 'consumption reporting'],
    signature_kpi: 'GRN Prepared',
    fields: [
      { label: 'Critical stock availability (status)', type: 'text', extraction_hint: 'Stock availability update', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of GRN prepared', type: 'number', extraction_hint: 'Goods received notes', is_signature_kpi: true, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of PO issued', type: 'number', extraction_hint: 'Purchase orders issued', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of items procured in emergency / after 5pm', type: 'number', extraction_hint: 'Emergency procurement', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Shortages / backorders', type: 'text', extraction_hint: 'Shortage descriptions', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Procurement escalations', type: 'text', extraction_hint: 'Procurement issues escalated', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'High-value purchase alerts', type: 'text', extraction_hint: 'Major purchase mentions', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
    ],
  },
  {
    slug: 'facility',
    name: 'Facility & Engineering',
    keywords: ['power', 'water', 'gas', 'oxygen', 'housekeeping', 'room readiness', 'maintenance', 'safety issue', 'lift', 'elevator', 'AC', 'HVAC', 'plumbing', 'generator', 'DG set'],
    signature_kpi: 'Readiness Status',
    fields: [
      { label: 'Facility readiness — power / water / gases', type: 'text', extraction_hint: 'Power/water/gas status', is_signature_kpi: true, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Safety issues', type: 'text', extraction_hint: 'Safety hazards reported', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Housekeeping & room readiness', type: 'text', extraction_hint: 'Housekeeping updates', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Preventive maintenance update', type: 'text', extraction_hint: 'PM schedule updates', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
    ],
  },
  {
    slug: 'pharmacy',
    name: 'Pharmacy',
    keywords: ['pharmacy revenue', 'IP pharmacy', 'OP pharmacy', 'stockout medicine', 'drug shortage', 'expiry', 'medicine stock', 'formulary'],
    signature_kpi: 'Pharmacy Rev MTD',
    fields: [
      { label: 'Pharmacy revenue — IP today (Rs.)', type: 'number', extraction_hint: 'IP pharmacy revenue', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Pharmacy revenue — OP today (Rs.)', type: 'number', extraction_hint: 'OP pharmacy revenue', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Pharmacy revenue MTD (Rs.)', type: 'number', extraction_hint: 'Month-to-date pharmacy revenue', is_signature_kpi: true, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Stockouts / shortages', type: 'text', extraction_hint: 'Drug shortage mentions', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Items expiring within 3 months', type: 'text', extraction_hint: 'Near-expiry drug alerts', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
    ],
  },
  {
    slug: 'training',
    name: 'Training',
    keywords: ['training session', 'workshop', 'participant', 'MTD training', 'induction training', 'fire drill', 'BLS', 'ACLS'],
    signature_kpi: 'Training MTD Status',
    fields: [
      { label: 'Training conducted today (topic)', type: 'text', extraction_hint: 'Training session topic', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of participants', type: 'number', extraction_hint: 'Attendance count', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'MTD trainings completed vs planned', type: 'text', extraction_hint: 'Training progress status', is_signature_kpi: true, added_by: 'seed', added_at: SEED_DATE },
    ],
  },
  {
    slug: 'clinical-lab',
    name: 'Clinical Lab',
    keywords: ['lab', 'critical report', 'TAT', 'turnaround time', 'blood bank', 'transfusion', 'outsourced test', 'reagent', 'sample', 'recollection', 'reporting error'],
    signature_kpi: 'Critical Reports',
    fields: [
      { label: 'Machine & equipment status', type: 'text', extraction_hint: 'Lab machine status', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of Critical reports issued', type: 'number', extraction_hint: 'Critical lab reports', is_signature_kpi: true, added_by: 'seed', added_at: SEED_DATE },
      { label: 'TAT performance', type: 'text', extraction_hint: 'Turnaround time status', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Transfusion / blood request issues', type: 'text', extraction_hint: 'Blood bank issues', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of Outsourced tests MTD', type: 'number', extraction_hint: 'Tests sent outside', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Reagent shortages', type: 'text', extraction_hint: 'Reagent availability', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Sample recollection / reporting errors', type: 'text', extraction_hint: 'Lab error mentions', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
    ],
  },
  {
    slug: 'radiology',
    name: 'Radiology',
    keywords: ['X-ray', 'USG', 'ultrasound', 'CT', 'MRI', 'imaging', 'radiology report', 'film', 'contrast', 'radiation'],
    signature_kpi: 'Imaging Cases',
    fields: [
      { label: '# of X-Ray cases (yesterday)', type: 'number', extraction_hint: 'X-ray volume', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of USG cases (yesterday)', type: 'number', extraction_hint: 'Ultrasound volume', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of CT cases (yesterday)', type: 'number', extraction_hint: 'CT scan volume', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Equipment status — CT / MRI / USG uptime', type: 'text', extraction_hint: 'Imaging equipment status', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of Reports done in-house', type: 'number', extraction_hint: 'In-house reporting count', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Pending reports — critical / non-critical', type: 'text', extraction_hint: 'Report backlog', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
    ],
  },
  {
    slug: 'ot',
    name: 'OT (Operating Theatre)',
    keywords: ['OT', 'operation theatre', 'surgery', 'first case delay', 'surgeon escalation', 'consumable', 'OT schedule', 'anesthesia'],
    signature_kpi: 'OT Cases',
    fields: [
      { label: '# of OT cases done (yesterday)', type: 'number', extraction_hint: 'Surgeries completed', is_signature_kpi: true, added_by: 'seed', added_at: SEED_DATE },
      { label: 'First case delay — time in minutes', type: 'number', extraction_hint: 'Delay in minutes', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'First case delay — reason', type: 'text', extraction_hint: 'Delay reason', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of Escalations by surgeon', type: 'number', extraction_hint: 'Surgeon complaints', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of times team left OT for consumables', type: 'number', extraction_hint: 'Consumable runs', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
    ],
  },
  {
    slug: 'hr-manpower',
    name: 'HR & Manpower',
    keywords: ['joiner', 'resignation', 'exit', 'replacement', 'manpower', 'vacancy', 'interview', 'induction', 'doctor profile', 'HR'],
    signature_kpi: 'Staffing Status',
    fields: [
      { label: 'New joiners today (names / nil)', type: 'text', extraction_hint: 'New staff names', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Resignations / exits today (names / nil)', type: 'text', extraction_hint: 'Departing staff names', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Replacement status', type: 'text', extraction_hint: 'Hiring/replacement progress', is_signature_kpi: true, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Mandatory training / induction status', type: 'text', extraction_hint: 'Induction updates', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'New doctor profile creation status', type: 'text', extraction_hint: 'Doctor onboarding', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
    ],
  },
  {
    slug: 'diet',
    name: 'Diet & Nutrition',
    keywords: ['diet', 'BCA', 'food feedback', 'kitchen', 'meal', 'nutrition', 'cafeteria food', 'discharge diet'],
    signature_kpi: 'BCA MTD',
    fields: [
      { label: 'Daily census — diet patients', type: 'number', extraction_hint: 'Patients on therapeutic diets', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'BCA done today', type: 'number', extraction_hint: 'Body composition assessments today', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'BCA MTD total', type: 'number', extraction_hint: 'Month-to-date BCAs', is_signature_kpi: true, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Food feedback summary', type: 'text', extraction_hint: 'Patient food feedback', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Delays / incidents', type: 'text', extraction_hint: 'Food service issues', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
    ],
  },
  {
    slug: 'biomedical',
    name: 'Biomedical',
    keywords: ['equipment readiness', 'breakdown', 'repair', 'preventive maintenance', 'PM compliance', 'AMC', 'biomedical equipment', 'ventilator', 'monitor', 'defibrillator'],
    signature_kpi: 'Equipment Status',
    fields: [
      { label: 'Equipment readiness — OT, ICU, etc.', type: 'text', extraction_hint: 'Equipment status overview', is_signature_kpi: true, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Breakdown updates', type: 'text', extraction_hint: 'What broke down, status', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Pending repairs', type: 'text', extraction_hint: 'Repairs awaiting completion', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Preventive maintenance compliance', type: 'text', extraction_hint: 'PM schedule status', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
    ],
  },
  {
    slug: 'nursing',
    name: 'Nursing',
    keywords: ['nurse', 'staffing matrix', 'nursing duty', 'patient complaint nursing', 'HAI', 'IPC', 'infection control', 'biomedical waste', 'cafeteria', 'dialysis'],
    signature_kpi: 'Nurses on Duty',
    fields: [
      { label: 'Midnight census — patient count', type: 'number', extraction_hint: 'Patient count', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Staffing matrix — nurses on duty', type: 'number', extraction_hint: 'Nurses on duty', is_signature_kpi: true, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Escalations / concerns', type: 'text', extraction_hint: 'Nursing escalations', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Daily HAI/IPC status (CLABSI,VAP,CAUTI,SSI)', type: 'text', extraction_hint: 'Infection status', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Patient complaints & satisfaction', type: 'text', extraction_hint: 'Patient feedback', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Infection control update', type: 'text', extraction_hint: 'IPC updates', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Biomedical waste incidents', type: 'number', extraction_hint: 'Waste incidents', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
    ],
  },
  {
    slug: 'it',
    name: 'IT',
    keywords: ['HIS', 'server', 'downtime', 'uptime', 'IT ticket', 'network', 'software', 'patch', 'upgrade', 'printer', 'system slow', 'login issue', 'integration'],
    signature_kpi: 'Pending Tickets',
    fields: [
      { label: 'HIS uptime / downtime status', type: 'text', extraction_hint: 'System availability', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: '# of Pending IT tickets', type: 'number', extraction_hint: 'Open ticket count', is_signature_kpi: true, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Upgrades / patches in progress', type: 'text', extraction_hint: 'IT project updates', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
      { label: 'Integration issues', type: 'text', extraction_hint: 'System integration problems', is_signature_kpi: false, added_by: 'seed', added_at: SEED_DATE },
    ],
  },
];

// ── Global issues definition (Section 3 of rubric) ──

const GLOBAL_ISSUES = {
  critical: [
    { issue_id: 'deaths', label: 'Deaths', source_dept: 'emergency', description: 'Any mention of patient death' },
    { issue_id: 'sentinel', label: 'Sentinel Events', source_dept: 'patient-safety', description: 'Serious harm, never-events, wrong-site surgery' },
    { issue_id: 'adverse', label: 'Adverse Events', source_dept: 'patient-safety', description: 'Events that reached patient and caused harm' },
    { issue_id: 'falls', label: 'Patient Falls', source_dept: 'patient-safety', description: 'Any patient fall' },
    { issue_id: 'med-errors', label: 'Medication Errors', source_dept: 'patient-safety', description: 'Wrong drug, wrong dose, missed dose' },
    { issue_id: 'equipment-down', label: 'Equipment Breakdown', source_dept: 'biomedical', description: 'Equipment failure, breakdown, down' },
    { issue_id: 'stockout', label: 'Critical Stockouts', source_dept: 'supply-chain', description: 'Out of stock, critical shortage, unavailable' },
    { issue_id: 'dama-lama', label: 'DAMA/LAMA', source_dept: 'billing', description: 'Patient leaving against medical advice' },
  ],
  warnings: [
    { issue_id: 'pending-complaints', label: 'Pending Complaints', source_dept: 'customer-care', description: 'Unresolved patient complaints' },
    { issue_id: 'overdue-rca', label: 'Overdue RCAs', source_dept: 'patient-safety', description: 'Root cause analyses past due date' },
    { issue_id: 'open-nabh', label: 'Open NABH Issues', source_dept: 'patient-safety', description: 'NABH non-compliances' },
    { issue_id: 'lwbs', label: 'Patients LWBS', source_dept: 'emergency', description: 'Left without being seen' },
    { issue_id: 'doctor-delays', label: 'Doctor Delay Impact', source_dept: 'customer-care', description: 'Patients affected by doctor tardiness' },
    { issue_id: 'pending-tickets', label: 'Pending IT Tickets', source_dept: 'it', description: '>3 pending IT tickets' },
    { issue_id: 'pending-repairs', label: 'Pending Repairs', source_dept: 'biomedical', description: 'Equipment awaiting repair' },
  ],
};

// ── Seed execution ──

export async function seedRubric() {
  console.log('Seeding WhatsApp Analysis rubric...\n');

  let seeded = 0;

  // Seed department rubrics
  for (const dept of DEPARTMENTS) {
    await sql`
      INSERT INTO wa_rubric (slug, name, version, keywords, fields, sender_authority)
      VALUES (
        ${dept.slug},
        ${dept.name},
        1,
        ${JSON.stringify(dept.keywords)}::jsonb,
        ${JSON.stringify(dept.fields)}::jsonb,
        '{}'::jsonb
      )
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        keywords = EXCLUDED.keywords,
        fields = EXCLUDED.fields,
        updated_at = NOW()
    `;
    console.log(`  ✓ ${dept.name} (${dept.slug}) — ${dept.fields.length} fields, ${dept.keywords.length} keywords`);
    seeded++;
  }

  // Seed global issues
  await sql`
    INSERT INTO wa_rubric (slug, name, version, keywords, fields, global_issues)
    VALUES (
      'global-issues',
      'Global Issues (Red Flags & Warnings)',
      1,
      '[]'::jsonb,
      '[]'::jsonb,
      ${JSON.stringify(GLOBAL_ISSUES)}::jsonb
    )
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name,
      global_issues = EXCLUDED.global_issues,
      updated_at = NOW()
  `;
  console.log(`  ✓ Global Issues — ${GLOBAL_ISSUES.critical.length} critical, ${GLOBAL_ISSUES.warnings.length} warnings`);
  seeded++;

  // Log version records for seed
  const rubricRows = await sql`SELECT id, slug FROM wa_rubric`;
  for (const row of rubricRows) {
    const r = row as { id: string; slug: string };
    // Only insert seed version if none exists
    const existing = await sql`SELECT 1 FROM wa_rubric_versions WHERE rubric_id = ${r.id} AND change_type = 'seed' LIMIT 1`;
    if ((existing as unknown[]).length === 0) {
      await sql`
        INSERT INTO wa_rubric_versions (rubric_id, version, change_type, change_detail)
        VALUES (${r.id}, 1, 'seed', '{"source": "EHRC-WhatsApp-Chat-Analysis-Rubric.md", "seeded_at": "2026-04-06"}'::jsonb)
      `;
    }
  }

  console.log(`\n✅ Seeded ${seeded} rubric entries (17 departments + 1 global issues)`);
  console.log('Version records created for all entries.');
}

// Run as CLI script: npx tsx src/lib/wa-engine/seed-rubric.ts
if (typeof require !== 'undefined' && require.main === module) {
  seedRubric()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
