// ============================================
// LeadSquared API Client
// Handles all communication with the LSQ API
// for the EHRC Rounds integration.
//
// API Host: https://api-in21.leadsquared.com/v2/
// Auth: accessKey + secretKey as query params
// ============================================

const LSQ_API_HOST = process.env.LSQ_API_HOST || 'https://api-in21.leadsquared.com/v2';
const LSQ_ACCESS_KEY = process.env.LSQ_ACCESS_KEY || '';
const LSQ_SECRET_KEY = process.env.LSQ_SECRET_KEY || '';

function assertLSQConfigured() {
  if (!LSQ_ACCESS_KEY || !LSQ_SECRET_KEY) {
    throw new Error('[LeadSquared] LSQ_ACCESS_KEY and LSQ_SECRET_KEY must be configured');
  }
}

// ============================================
// TYPES
// ============================================

export interface LSQLeadRaw {
  ProspectID: string;
  ProspectAutoId: string;
  FirstName: string | null;
  LastName: string | null;
  EmailAddress: string | null;
  Phone: string | null;
  Mobile: string | null;
  Source: string | null;
  ProspectStage: string | null;
  Score: string | null;
  EngagementScore: string | null;
  OwnerId: string | null;
  OwnerIdName: string | null;
  OwnerIdEmailAddress: string | null;
  CreatedOn: string | null;
  ModifiedOn: string | null;
  Origin: string | null;
  LeadAge: string | null;
  // Custom fields (mx_ prefix)
  mx_Patient_Name: string | null;
  mx_Whatsapp_Number: string | null;
  mx_Gender: string | null;
  mx_Age: string | null;
  mx_Date_of_Birth: string | null;
  mx_Address: string | null;
  mx_City: string | null;
  mx_State: string | null;
  mx_Country: string | null;
  mx_Zip: string | null;
  mx_Street1: string | null;
  mx_UHID: string | null;
  mx_Ailment: string | null;
  mx_Marketing_ailment: string | null;
  mx_UTM_Source: string | null;
  mx_UTM_Campaign: string | null;
  mx_UTM_Medium: string | null;
  mx_UTM_Content: string | null;
  mx_Signup_URL: string | null;
  mx_signup_URL_2: string | null;
  mx_Surgery_Order_Value: string | null;
  mx_Latest_Doctor_Name: string | null;
  mx_Latest_Department_Visted: string | null;
  mx_Latest_Appoinment_Date_and_Time: string | null;
  mx_Latest_Hospital_location: string | null;
  mx_OP_or_IP_Number: string | null;
  mx_Lead_Assigned_On: string | null;
  mx_diagnosis: string | null;
  mx_diagnosis_speciality: string | null;
  mx_Prescription_URL: string | null;
  mx_Surgeon: string | null;
  mx_Account_ID: string | null;
  mx_Lead_Type: string | null;
  mx_Hospital_IPD: string | null;
  mx_OPD_Location: string | null;
  mx_Surgery_Completed_On: string | null;
  mx_Remarks: string | null;
  mx_Sub_remarks: string | null;
  mx_Doctor_Name: string | null;
  mx_Booking_Status: string | null;
  // Allow any additional mx_ fields
  [key: string]: string | null | undefined;
}

export interface LSQActivity {
  Id: string;
  EventCode: number;
  EventName: string;
  ActivityScore: number;
  CreatedOn: string;
  ActivityType: number;
  Type: string;
  RelatedProspectId: string;
  Data: Array<{ Key: string; Value: string }>;
  ModifiedOn: string;
}

export interface LSQActivityResponse {
  RecordCount: number;
  ProspectActivities: LSQActivity[];
}

// ============================================
// API HELPERS
// ============================================

import { logApiCall, type ApiCallLog } from './lsq-api-log';

// Current sync run ID — set by the sync engine so API calls
// can be linked back to the sync run that triggered them.
let _currentSyncRunId: string | null = null;
export function setCurrentSyncRunId(id: string | null): void { _currentSyncRunId = id; }
export function getCurrentSyncRunId(): string | null { return _currentSyncRunId; }

function buildUrl(endpoint: string, extraParams?: Record<string, string>): string {
  const url = new URL(`${LSQ_API_HOST}/${endpoint}`);
  url.searchParams.set('accessKey', LSQ_ACCESS_KEY);
  url.searchParams.set('secretKey', LSQ_SECRET_KEY);
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/**
 * Determine the call type from the endpoint for log categorization.
 */
function inferCallType(endpoint: string): ApiCallLog['callType'] {
  if (endpoint.includes('Leads.GetById')) return 'get_lead';
  if (endpoint.includes('Leads.Get')) return 'search_leads';
  if (endpoint.includes('ProspectActivity')) return 'get_activities';
  return 'other';
}

async function lsqFetch<T>(endpoint: string, options?: {
  method?: string;
  body?: unknown;
  extraParams?: Record<string, string>;
  leadId?: string;
}): Promise<T> {
  assertLSQConfigured();
  const url = buildUrl(endpoint, options?.extraParams);
  const method = options?.method || 'GET';
  const startTime = Date.now();

  const fetchOptions: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (options?.body) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  let responseStatus = 0;
  let responseData: unknown = null;
  let errorMessage: string | undefined;

  try {
    const response = await fetch(url, fetchOptions);
    responseStatus = response.status;

    if (!response.ok) {
      const errorText = await response.text();
      errorMessage = errorText;
      throw new Error(`LSQ API Error [${response.status}]: ${errorText}`);
    }

    responseData = await response.json();
    return responseData as T;
  } catch (error) {
    if (!errorMessage) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    if (responseStatus === 0) responseStatus = 0; // network error
    throw error;
  } finally {
    // Log every API call regardless of success/failure
    const durationMs = Date.now() - startTime;
    const callType = inferCallType(endpoint);

    // Truncate large response bodies for storage (keep first 2000 chars)
    let storedResponse = responseData;
    if (typeof storedResponse === 'object' && storedResponse !== null) {
      const jsonStr = JSON.stringify(storedResponse);
      if (jsonStr.length > 2000) {
        const arr = Array.isArray(storedResponse) ? storedResponse : null;
        storedResponse = {
          _truncated: true,
          _originalLength: jsonStr.length,
          _recordCount: arr ? arr.length : undefined,
          _preview: jsonStr.substring(0, 500),
        };
      }
    }

    logApiCall({
      endpoint,
      method,
      requestBody: options?.body || null,
      responseStatus,
      responseBody: storedResponse,
      errorMessage,
      durationMs,
      syncRunId: _currentSyncRunId || undefined,
      leadId: options?.leadId || options?.extraParams?.id || options?.extraParams?.leadId || undefined,
      callType,
    }).catch(() => { /* non-blocking */ });
  }
}

// ============================================
// LEAD MANAGEMENT
// ============================================

/**
 * Get a single lead by its ProspectID (UUID).
 */
export async function getLeadById(prospectId: string): Promise<LSQLeadRaw | null> {
  try {
    const data = await lsqFetch<LSQLeadRaw[]>(
      'LeadManagement.svc/Leads.GetById',
      { extraParams: { id: prospectId }, leadId: prospectId }
    );
    return data?.[0] || null;
  } catch (error) {
    console.error(`[LSQ] Failed to get lead ${prospectId}:`, error);
    return null;
  }
}

/**
 * Search leads by a field value. Returns up to pageSize leads.
 * Primary use: search by ProspectStage = "OPD WIN" or "IPD WIN"
 */
export async function searchLeadsByField(
  fieldName: string,
  fieldValue: string,
  pageIndex = 1,
  pageSize = 100
): Promise<LSQLeadRaw[]> {
  try {
    const data = await lsqFetch<LSQLeadRaw[]>(
      'LeadManagement.svc/Leads.Get',
      {
        method: 'POST',
        body: {
          Parameter: {
            LookupName: fieldName,
            LookupValue: fieldValue,
            SqlOperator: '=',
          },
          Paging: {
            PageIndex: pageIndex,
            PageSize: pageSize,
          },
        },
      }
    );
    return data || [];
  } catch (error) {
    console.error(`[LSQ] Failed to search leads by ${fieldName}=${fieldValue}:`, error);
    return [];
  }
}

/**
 * Get all leads with a specific stage (e.g., "OPD WIN", "IPD WIN").
 * Paginates through all results.
 */
export async function getLeadsByStage(stage: string): Promise<LSQLeadRaw[]> {
  const allLeads: LSQLeadRaw[] = [];
  let pageIndex = 1;
  const pageSize = 200;

  while (true) {
    const batch = await searchLeadsByField('ProspectStage', stage, pageIndex, pageSize);
    allLeads.push(...batch);

    if (batch.length < pageSize) break;
    pageIndex++;

    // Safety limit: max 10 pages (2000 leads)
    if (pageIndex > 10) break;
  }

  return allLeads;
}

/**
 * Get leads modified after a specific date.
 * Used by polling to only sync recently changed leads.
 */
export async function getLeadsModifiedAfter(
  stage: string,
  afterDate: string // ISO date string
): Promise<LSQLeadRaw[]> {
  // LSQ doesn't have a direct "modified after + stage" combined search,
  // so we fetch by stage and filter client-side.
  // For large datasets, we'd use the Search API with multiple parameters.
  const leads = await getLeadsByStage(stage);
  return leads.filter(lead => {
    const modifiedOn = lead.ModifiedOn;
    if (!modifiedOn) return false;
    return new Date(modifiedOn) > new Date(afterDate);
  });
}

// ============================================
// ACTIVITY MANAGEMENT
// ============================================

/**
 * Get activity history for a specific lead.
 * Includes phone calls, form submissions, stage changes, appointments.
 */
export async function getLeadActivities(
  leadId: string,
  fromDate?: string,
  toDate?: string,
  pageIndex = 1,
  pageSize = 100
): Promise<LSQActivityResponse> {
  try {
    const body: Record<string, unknown> = {
      Paging: { PageIndex: pageIndex, PageSize: pageSize },
    };

    if (fromDate || toDate) {
      body.Parameter = {
        FromDate: fromDate || '2025-01-01',
        ToDate: toDate || new Date().toISOString().split('T')[0],
      };
    }

    return await lsqFetch<LSQActivityResponse>(
      'ProspectActivity.svc/Retrieve',
      {
        method: 'POST',
        body,
        extraParams: { leadId },
      }
    );
  } catch (error) {
    console.error(`[LSQ] Failed to get activities for lead ${leadId}:`, error);
    return { RecordCount: 0, ProspectActivities: [] };
  }
}

/**
 * Get all activities for a lead (paginated).
 */
export async function getAllLeadActivities(leadId: string): Promise<LSQActivity[]> {
  const allActivities: LSQActivity[] = [];
  let pageIndex = 1;
  const pageSize = 200;

  while (true) {
    const response = await getLeadActivities(leadId, undefined, undefined, pageIndex, pageSize);
    allActivities.push(...response.ProspectActivities);

    if (response.ProspectActivities.length < pageSize) break;
    pageIndex++;

    // Safety limit: max 5 pages (1000 activities)
    if (pageIndex > 5) break;
  }

  return allActivities;
}

// ============================================
// DATA EXTRACTION HELPERS
// ============================================

/**
 * Extract a value from an LSQ activity's Data array.
 */
export function extractActivityDataValue(activity: LSQActivity, key: string): string | null {
  const item = activity.Data?.find(d => d.Key === key);
  return item?.Value || null;
}

/**
 * Extract doctor name, clinic, appointment date from activity history.
 * Scans OPD and IPD phone call activities for form data.
 */
export function extractClinicalInfoFromActivities(activities: LSQActivity[]): {
  doctorName: string | null;
  clinic: string | null;
  appointmentDate: string | null;
  hospitalLocation: string | null;
  surgeryRecommended: boolean;
  disposition: string | null;
  remarks: string | null;
} {
  let doctorName: string | null = null;
  let clinic: string | null = null;
  let appointmentDate: string | null = null;
  let hospitalLocation: string | null = null;
  let surgeryRecommended = false;
  let disposition: string | null = null;
  let remarks: string | null = null;

  // Process activities in reverse chronological order (newest first)
  for (const activity of activities) {
    const eventName = activity.EventName?.toLowerCase() || '';

    // Look for OPD/IPD phone call or appointment activities
    if (eventName.includes('opd') || eventName.includes('ipd') || eventName.includes('appointment')) {
      for (const dataItem of activity.Data || []) {
        const key = dataItem.Key?.toLowerCase() || '';
        const value = dataItem.Value;

        if (!value) continue;

        // Try to extract from NewData JSON
        if (key === 'newdata') {
          try {
            const newData = JSON.parse(value);
            // Common custom field patterns in LSQ
            for (const [nk, nv] of Object.entries(newData)) {
              if (!nv || typeof nv !== 'string') continue;
              const nkLower = nk.toLowerCase();
              if (nkLower.includes('doctor') && !doctorName) doctorName = nv;
              if (nkLower.includes('clinic') && !clinic) clinic = nv;
              if (nkLower.includes('hospital') && !hospitalLocation) hospitalLocation = nv;
              if (nkLower.includes('appointment') && nkLower.includes('date') && !appointmentDate) appointmentDate = nv;
              if (nkLower.includes('disposition') && !disposition) disposition = nv;
              if (nkLower.includes('remark') && !remarks) remarks = nv;
              if (nv.toLowerCase().includes('surgery recommended') || nv.toLowerCase().includes('surgery likely')) {
                surgeryRecommended = true;
              }
            }
          } catch {
            // Not JSON, skip
          }
        }

        // Direct key extraction
        if (key.includes('doctor') && !doctorName) doctorName = value;
        if (key.includes('clinic') && !clinic) clinic = value;
        if (key.includes('hospital') && !hospitalLocation) hospitalLocation = value;
        if (key.includes('disposition') && !disposition) disposition = value;
        if (key === 'notes' && !remarks) {
          try {
            // Notes sometimes contain structured data
            if (!value.startsWith('{')) remarks = value;
          } catch {
            remarks = value;
          }
        }
      }
    }

    // Look for stage change activities
    if (eventName.includes('stage') || activity.EventCode === 215) {
      for (const dataItem of activity.Data || []) {
        if (dataItem.Key === 'NewData') {
          try {
            const newData = JSON.parse(dataItem.Value);
            if (newData.ProspectStage?.includes('Surgery Recommended')) {
              surgeryRecommended = true;
            }
          } catch {
            // Not JSON
          }
        }
      }
    }
  }

  return { doctorName, clinic, appointmentDate, hospitalLocation, surgeryRecommended, disposition, remarks };
}

// ============================================
// AILMENT PARSING FROM UTM CAMPAIGN
// ============================================

/**
 * Known ailment keywords mapped from UTM campaign names.
 * UTM campaigns follow patterns like:
 *   Even_hospital_Gallstone_High_Intent_Exact
 *   Even_hospitals_circumcision_high_intent_exact
 *   Piles_Surgery_Female
 */
const AILMENT_KEYWORDS: Record<string, string> = {
  'gallstone': 'Gallstones',
  'gallbladder': 'Gallstones',
  'circumcision': 'Circumcision',
  'phimosis': 'Phimosis',
  'piles': 'Piles/Hemorrhoids',
  'fissure': 'Anal Fissure',
  'fistula': 'Fistula',
  'hernia': 'Hernia',
  'umbilical_hernia': 'Umbilical Hernia',
  'inguinal_hernia': 'Inguinal Hernia',
  'appendix': 'Appendicitis',
  'appendicitis': 'Appendicitis',
  'kidney_stone': 'Kidney Stones',
  'kidney': 'Kidney Stones',
  'varicocele': 'Varicocele',
  'hydrocele': 'Hydrocele',
  'varicose': 'Varicose Veins',
  'cataract': 'Cataract',
  'lasik': 'LASIK',
  'knee_replacement': 'Knee Replacement',
  'tkr': 'Total Knee Replacement',
  'hip_replacement': 'Hip Replacement',
  'thr': 'Total Hip Replacement',
  'spine': 'Spine Surgery',
  'bariatric': 'Bariatric Surgery',
  'weight_loss': 'Bariatric Surgery',
  'gynecomastia': 'Gynecomastia',
  'lipoma': 'Lipoma',
  'acl': 'ACL Reconstruction',
  'shoulder': 'Shoulder Surgery',
  'colorectal': 'Colorectal Surgery',
  'proctology': 'Proctology',
};

/**
 * Parse ailment from UTM campaign name and signup URL.
 * Returns the best-match ailment or null.
 */
export function parseAilmentFromUTM(
  utmCampaign: string | null,
  signupUrl: string | null,
  utmTerm?: string | null
): string | null {
  // Combine all text sources for matching
  const searchText = [
    utmCampaign,
    signupUrl,
    utmTerm,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[_-]/g, ' ');

  if (!searchText) return null;

  // Check each keyword
  for (const [keyword, ailment] of Object.entries(AILMENT_KEYWORDS)) {
    const normalizedKeyword = keyword.replace(/_/g, ' ');
    if (searchText.includes(normalizedKeyword)) {
      return ailment;
    }
  }

  // Try to extract from signup URL path (e.g., /specialties/gallstones-treatment/)
  try {
    const urlMatch = signupUrl?.match(/specialties\/([^/?]+)/);
    if (urlMatch) {
      const specialty = urlMatch[1].replace(/-/g, ' ');
      // Capitalize first letter of each word
      return specialty.replace(/\b\w/g, c => c.toUpperCase());
    }
  } catch {
    // URL parsing failed
  }

  return null;
}

// ============================================
// LEAD NORMALIZATION
// ============================================

export interface NormalizedLead {
  // Identity
  lsqLeadId: string;
  lsqProspectAutoId: string;
  patientName: string;

  // Contact
  phone: string | null;
  whatsappNumber: string | null;
  email: string | null;

  // Demographics
  gender: string | null;
  age: number | null;
  dateOfBirth: string | null;

  // Address
  city: string | null;
  state: string | null;
  address: string | null;
  zip: string | null;

  // Clinical
  ailment: string | null;
  uhid: string | null;
  ipNumber: string | null;
  doctorName: string | null;
  appointmentDate: string | null;
  hospitalLocation: string | null;
  primaryDiagnosis: string | null;
  plannedProcedure: string | null;
  surgeryOrderValue: number | null;

  // Journey
  lsqLeadStage: string;
  roundsStage: 'opd' | 'pre_admission';
  leadSource: string | null;

  // Marketing
  utmSource: string | null;
  utmCampaign: string | null;
  utmMedium: string | null;
  signupUrl: string | null;

  // LSQ metadata
  ownerName: string | null;
  ownerEmail: string | null;
  lsqCreatedOn: string | null;
}

/**
 * Normalize a raw LSQ lead into a clean structure for Rounds.
 */
export function normalizeLead(raw: LSQLeadRaw): NormalizedLead {
  const firstName = raw.FirstName?.trim() || '';
  const lastName = raw.LastName?.trim() || '';
  const patientName = raw.mx_Patient_Name?.trim()
    || [firstName, lastName].filter(Boolean).join(' ')
    || `Lead ${raw.ProspectAutoId}`;

  // Determine Rounds stage from LSQ stage
  const lsqStage = raw.ProspectStage?.trim() || '';
  const roundsStage = lsqStage === 'IPD WIN' ? 'pre_admission' as const : 'opd' as const;

  // Parse ailment from explicit field OR UTM campaign
  const ailment = raw.mx_Ailment?.trim()
    || raw.mx_Marketing_ailment?.trim()
    || raw.mx_diagnosis?.trim()
    || parseAilmentFromUTM(
        raw.mx_UTM_Campaign,
        raw.mx_Signup_URL || raw.mx_signup_URL_2,
      );

  // Parse surgery order value
  let surgeryOrderValue: number | null = null;
  if (raw.mx_Surgery_Order_Value) {
    const parsed = parseFloat(raw.mx_Surgery_Order_Value);
    if (!isNaN(parsed) && parsed > 10) { // Filter out obvious non-values like "2", "3"
      surgeryOrderValue = parsed;
    }
  }

  // Parse age
  let age: number | null = null;
  if (raw.mx_Age) {
    const parsedAge = parseInt(raw.mx_Age);
    if (!isNaN(parsedAge) && parsedAge > 0 && parsedAge < 150) {
      age = parsedAge;
    }
  }

  return {
    lsqLeadId: raw.ProspectID,
    lsqProspectAutoId: raw.ProspectAutoId,
    patientName,

    phone: raw.Phone?.trim() || raw.Mobile?.trim() || null,
    whatsappNumber: raw.mx_Whatsapp_Number?.trim() || null,
    email: raw.EmailAddress?.trim() || null,

    gender: raw.mx_Gender?.trim() || null,
    age,
    dateOfBirth: raw.mx_Date_of_Birth?.trim() || null,

    city: raw.mx_City?.trim() || null,
    state: raw.mx_State?.trim() || null,
    address: raw.mx_Address?.trim() || raw.mx_Street1?.trim() || null,
    zip: raw.mx_Zip?.trim() || null,

    ailment,
    uhid: raw.mx_UHID?.trim() || null,
    ipNumber: raw.mx_OP_or_IP_Number?.trim() || null,
    doctorName: raw.mx_Latest_Doctor_Name?.trim() || raw.mx_Doctor_Name?.trim() || raw.mx_Surgeon?.trim() || null,
    appointmentDate: raw.mx_Latest_Appoinment_Date_and_Time?.trim() || null,
    hospitalLocation: raw.mx_Latest_Hospital_location?.trim() || raw.mx_OPD_Location?.trim() || raw.mx_Hospital_IPD?.trim() || null,
    primaryDiagnosis: raw.mx_diagnosis?.trim() || null,
    plannedProcedure: ailment, // Best guess — refine from activities
    surgeryOrderValue,

    lsqLeadStage: lsqStage,
    roundsStage,
    leadSource: raw.Source?.trim() || null,

    utmSource: raw.mx_UTM_Source?.trim() || null,
    utmCampaign: raw.mx_UTM_Campaign?.trim() || null,
    utmMedium: raw.mx_UTM_Medium?.trim() || null,
    signupUrl: raw.mx_Signup_URL?.trim() || null,

    ownerName: raw.OwnerIdName?.trim() || null,
    ownerEmail: raw.OwnerIdEmailAddress?.trim() || null,
    lsqCreatedOn: raw.CreatedOn || null,
  };
}
