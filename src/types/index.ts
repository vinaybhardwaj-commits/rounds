// ============================================
// Rounds — Type Definitions
// ============================================

// --- Roles ---
export type UserRole =
  | 'super_admin'
  | 'department_head'
  | 'staff'
  | 'pac_coordinator'
  | 'marketing'
  | 'guest';

// --- Account Type ---
export type AccountType = 'internal' | 'guest';

// --- Profile Status ---
export type ProfileStatus = 'pending_approval' | 'active' | 'suspended' | 'rejected';

// --- Profile ---
export interface Profile {
  id: string;
  email: string;
  full_name: string;
  display_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  account_type: AccountType;
  department_id: string | null;
  department_name?: string;
  designation: string | null;
  phone: string | null;
  status: ProfileStatus;
  is_active: boolean;
  password_hash?: string | null;
  kiosk_pin_hash: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
  last_login_at: string | null;
}

// --- Department ---
export interface Department {
  id: string;
  name: string;
  slug: string;
  head_profile_id: string | null;
  head_name?: string;
  is_active: boolean;
  created_at: string;
}

// --- Message Types (6 structured + 1 general) ---
export type MessageType =
  | 'general'
  | 'request'
  | 'update'
  | 'escalation'
  | 'fyi'
  | 'decision_needed'
  | 'patient_lead';

// --- Message Priority ---
export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent';

// --- Conversation Type ---
export type ConversationType = 'group' | 'dm';

// --- Conversation ---
export interface Conversation {
  id: string;
  type: ConversationType;
  name: string | null;
  description: string | null;
  department_id: string | null;
  created_by: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

// --- Message ---
export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name?: string;
  message_type: MessageType;
  priority: MessagePriority;
  content: string;
  parent_message_id: string | null;
  is_edited: boolean;
  created_at: string;
  updated_at: string;
}

// --- Conversation Member ---
export interface ConversationMember {
  conversation_id: string;
  profile_id: string;
  role: 'admin' | 'member';
  joined_at: string;
  last_read_at: string | null;
}

// --- CSV Import Row ---
export interface CSVImportRow {
  email: string;
  full_name: string;
  department: string;
  role?: string;
  designation?: string;
  phone?: string;
}

// --- CSV Import Result ---
export interface CSVImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; email: string; error: string }[];
}

// --- API Response ---
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// --- Guest Invitation ---
export interface GuestInvitation {
  id: string;
  email: string;
  invited_by: string;
  role: UserRole;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}
