// ============================================
// OT Surgery Readiness — Procedure Defaults
// Smart suggestions when posting a surgery
// ============================================

import type { WoundClass, AnaesthesiaType, PostOpDestination } from '@/types';

export interface ProcedureDefaults {
  wound_class: WoundClass;
  anaesthesia_type: AnaesthesiaType;
  post_op_destination: PostOpDestination;
  estimated_duration_minutes: number;
  typically_requires_blood: boolean;
  typically_requires_implant: boolean;
}

export const PROCEDURE_DEFAULTS: Record<string, ProcedureDefaults> = {
  'Unilateral TKR':                        { wound_class: 'Clean', anaesthesia_type: 'SA', post_op_destination: 'Ward', estimated_duration_minutes: 120, typically_requires_blood: true, typically_requires_implant: true },
  'Bilateral TKR':                         { wound_class: 'Clean', anaesthesia_type: 'SA', post_op_destination: 'ICU', estimated_duration_minutes: 210, typically_requires_blood: true, typically_requires_implant: true },
  'Total Hip Replacement':                 { wound_class: 'Clean', anaesthesia_type: 'SA', post_op_destination: 'Ward', estimated_duration_minutes: 150, typically_requires_blood: true, typically_requires_implant: true },
  'Arthroscopic ACL Reconstruction':       { wound_class: 'Clean', anaesthesia_type: 'SA', post_op_destination: 'Ward', estimated_duration_minutes: 90, typically_requires_blood: false, typically_requires_implant: true },
  'Implant Removal':                       { wound_class: 'Clean', anaesthesia_type: 'SA', post_op_destination: 'Ward', estimated_duration_minutes: 60, typically_requires_blood: false, typically_requires_implant: false },
  'Deformity Correction':                  { wound_class: 'Clean', anaesthesia_type: 'GA', post_op_destination: 'Ward', estimated_duration_minutes: 180, typically_requires_blood: true, typically_requires_implant: true },
  'ORIF':                                  { wound_class: 'Clean', anaesthesia_type: 'GA', post_op_destination: 'Ward', estimated_duration_minutes: 120, typically_requires_blood: true, typically_requires_implant: true },
  'DHS Fixation':                          { wound_class: 'Clean', anaesthesia_type: 'SA', post_op_destination: 'Ward', estimated_duration_minutes: 90, typically_requires_blood: true, typically_requires_implant: true },
  'Laparoscopic Cholecystectomy':          { wound_class: 'Clean', anaesthesia_type: 'GA', post_op_destination: 'PACU', estimated_duration_minutes: 60, typically_requires_blood: false, typically_requires_implant: false },
  'Lap B/L Inguinal Hernia + Mesh Repair': { wound_class: 'Clean', anaesthesia_type: 'GA', post_op_destination: 'PACU', estimated_duration_minutes: 90, typically_requires_blood: false, typically_requires_implant: true },
  'Lap Appendicectomy':                    { wound_class: 'Clean-Contaminated', anaesthesia_type: 'GA', post_op_destination: 'PACU', estimated_duration_minutes: 45, typically_requires_blood: false, typically_requires_implant: false },
  'ERCP':                                  { wound_class: 'Clean-Contaminated', anaesthesia_type: 'Sedation', post_op_destination: 'PACU', estimated_duration_minutes: 45, typically_requires_blood: false, typically_requires_implant: false },
  'Laparoscopic Fundoplication':           { wound_class: 'Clean', anaesthesia_type: 'GA', post_op_destination: 'Ward', estimated_duration_minutes: 120, typically_requires_blood: false, typically_requires_implant: false },
  'Sebaceous Cyst Excision':               { wound_class: 'Clean', anaesthesia_type: 'LA', post_op_destination: 'PACU', estimated_duration_minutes: 30, typically_requires_blood: false, typically_requires_implant: false },
  'Lipoma Excision':                       { wound_class: 'Clean', anaesthesia_type: 'LA', post_op_destination: 'PACU', estimated_duration_minutes: 30, typically_requires_blood: false, typically_requires_implant: false },
  'Laser Haemorrhoidectomy':               { wound_class: 'Clean-Contaminated', anaesthesia_type: 'SA', post_op_destination: 'PACU', estimated_duration_minutes: 30, typically_requires_blood: false, typically_requires_implant: false },
  'Fissurectomy':                          { wound_class: 'Clean-Contaminated', anaesthesia_type: 'SA', post_op_destination: 'PACU', estimated_duration_minutes: 30, typically_requires_blood: false, typically_requires_implant: false },
  'Fistulectomy':                          { wound_class: 'Dirty', anaesthesia_type: 'SA', post_op_destination: 'PACU', estimated_duration_minutes: 45, typically_requires_blood: false, typically_requires_implant: false },
  'Laser Sphincterotomy':                  { wound_class: 'Clean-Contaminated', anaesthesia_type: 'SA', post_op_destination: 'PACU', estimated_duration_minutes: 30, typically_requires_blood: false, typically_requires_implant: false },
  'EUA + Haemorrhoidectomy':               { wound_class: 'Clean-Contaminated', anaesthesia_type: 'SA', post_op_destination: 'PACU', estimated_duration_minutes: 45, typically_requires_blood: false, typically_requires_implant: false },
  'Circumcision':                          { wound_class: 'Clean', anaesthesia_type: 'LA', post_op_destination: 'PACU', estimated_duration_minutes: 30, typically_requires_blood: false, typically_requires_implant: false },
  'Stapler Circumcision':                  { wound_class: 'Clean', anaesthesia_type: 'LA', post_op_destination: 'PACU', estimated_duration_minutes: 20, typically_requires_blood: false, typically_requires_implant: false },
  'TURP':                                  { wound_class: 'Clean-Contaminated', anaesthesia_type: 'SA', post_op_destination: 'Ward', estimated_duration_minutes: 60, typically_requires_blood: true, typically_requires_implant: false },
  'URS + RIRS':                            { wound_class: 'Clean', anaesthesia_type: 'GA', post_op_destination: 'PACU', estimated_duration_minutes: 60, typically_requires_blood: false, typically_requires_implant: false },
  'Septoplasty':                           { wound_class: 'Clean', anaesthesia_type: 'GA', post_op_destination: 'PACU', estimated_duration_minutes: 60, typically_requires_blood: false, typically_requires_implant: false },
  'Adenotonsillectomy':                    { wound_class: 'Clean-Contaminated', anaesthesia_type: 'GA', post_op_destination: 'Ward', estimated_duration_minutes: 45, typically_requires_blood: false, typically_requires_implant: false },
  'FESS':                                  { wound_class: 'Clean', anaesthesia_type: 'GA', post_op_destination: 'PACU', estimated_duration_minutes: 90, typically_requires_blood: false, typically_requires_implant: false },
  'B/L EVLT':                              { wound_class: 'Clean', anaesthesia_type: 'SA', post_op_destination: 'PACU', estimated_duration_minutes: 90, typically_requires_blood: false, typically_requires_implant: false },
  'Varicose Vein Surgery':                 { wound_class: 'Clean', anaesthesia_type: 'SA', post_op_destination: 'PACU', estimated_duration_minutes: 90, typically_requires_blood: false, typically_requires_implant: false },
  'Craniotomy':                            { wound_class: 'Clean', anaesthesia_type: 'GA', post_op_destination: 'ICU', estimated_duration_minutes: 240, typically_requires_blood: true, typically_requires_implant: false },
  'Decompression + Fixation':              { wound_class: 'Clean', anaesthesia_type: 'GA', post_op_destination: 'ICU', estimated_duration_minutes: 180, typically_requires_blood: true, typically_requires_implant: true },
};

/**
 * Get procedure defaults by name. Tries exact match first, then fuzzy substring match.
 * Returns null for unknown procedures — all fields remain manual.
 */
export function getProcedureDefaults(procedureName: string): ProcedureDefaults | null {
  // Exact match
  if (PROCEDURE_DEFAULTS[procedureName]) return PROCEDURE_DEFAULTS[procedureName];
  // Fuzzy: check if procedure contains a known key (case-insensitive)
  const lower = procedureName.toLowerCase();
  for (const [key, defaults] of Object.entries(PROCEDURE_DEFAULTS)) {
    if (lower.includes(key.toLowerCase())) return defaults;
  }
  return null;
}

// Seed data for autocomplete
export const KNOWN_SURGEONS = [
  { name: 'Dr. Poornima Parasuraman', specialty: 'General Surgery' },
  { name: 'Dr. Sajeet Nayar', specialty: 'General Surgery' },
  { name: 'Dr. Anil Mehta', specialty: 'General Surgery' },
  { name: 'Dr. Harish Puranik', specialty: 'Orthopaedics' },
  { name: 'Dr. Prajwal', specialty: 'Orthopaedics' },
  { name: 'Dr. Avinash', specialty: 'Orthopaedics' },
  { name: 'Dr. Karthik', specialty: 'Orthopaedics / Neurosurgery' },
  { name: 'Dr. Rakesh', specialty: 'Orthopaedics' },
  { name: 'Dr. Prabhudev Solanki', specialty: 'General Surgery' },
  { name: 'Dr. Animesh Banerjee', specialty: 'ENT' },
  { name: 'Dr. Uday Ravi', specialty: 'Urology / Proctology' },
  { name: 'Dr. Vishal Naik', specialty: 'Urology' },
  { name: 'Dr. Harsh', specialty: 'Vascular Surgery' },
  { name: 'Dr. Prem', specialty: 'Urology' },
  { name: 'Dr. Amaresh', specialty: 'Neurosurgery' },
  { name: 'Dr. Priyanka', specialty: 'General Surgery' },
  { name: 'Dr. Sujay', specialty: 'General Surgery / Proctology' },
];

export const KNOWN_ANAESTHESIOLOGISTS = [
  { name: 'Dr. Manukumar', role: 'Head of Anaesthesia' },
  { name: 'Dr. Jeevashri', role: 'Anaesthesiologist' },
  { name: 'Dr. Shilpa', role: 'Intensivist / Anaesthesiologist' },
  { name: 'Dr. Shashank', role: 'Anaesthesiologist' },
  { name: 'Dr. Trishi', role: 'Anaesthesiologist' },
];

export const COMMON_PROCEDURES = [
  'Unilateral TKR', 'Bilateral TKR', 'Total Hip Replacement',
  'Arthroscopic ACL Reconstruction', 'Implant Removal',
  'Deformity Correction', 'ORIF', 'DHS Fixation',
  'Laparoscopic Cholecystectomy', 'Lap B/L Inguinal Hernia + Mesh Repair',
  'Lap Appendicectomy', 'ERCP', 'Laparoscopic Fundoplication',
  'Sebaceous Cyst Excision', 'Lipoma Excision',
  'Laser Haemorrhoidectomy', 'Fissurectomy', 'Fistulectomy',
  'Laser Sphincterotomy', 'EUA + Haemorrhoidectomy',
  'Circumcision', 'Stapler Circumcision', 'TURP', 'URS + RIRS',
  'Septoplasty', 'Adenotonsillectomy', 'FESS',
  'B/L EVLT', 'Varicose Vein Surgery',
  'Craniotomy', 'Decompression + Fixation',
];
