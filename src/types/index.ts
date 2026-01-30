export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  propertyId: string;
  active: boolean;
  passwordChangeRequired?: boolean;
  authProvider?: 'db' | 'local' | 'supabase';
}

export type UserRole =
  | 'admin'
  | 'manager'
  | 'frontdesk'
  | 'auditor'
  | 'posmanager'
  | 'housekeeping'
  | 'cashier'
  | 'barman'
  | 'supervisor';

export interface Room {
  id: string;
  number: string;
  type: string;
  status: RoomStatus;
  floor: number;
  rate: number;
  guestId?: string;
}

export type RoomStatus = 'VC' | 'VD' | 'OC' | 'OD' | 'OOO' | 'OOS';

export interface Guest {
  id: string;
  name: string;
  email: string;
  phone: string;
  roomNumber?: string;
  checkIn?: string;
  checkOut?: string;
  folioBalance: number;
}

export interface Reservation {
  id: string;
  guestName: string;
  // Mandatory field: Country/Region of Origin for reporting and pricing
  originRegion: string;
  // Rate plan/package code, e.g., RO, BB, DBB
  packageCode?: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  status: 'confirmed' | 'checked-in' | 'checked-out' | 'cancelled';
  rate: number;
  adults: number;
  children: number;
  // Sensitive identification document number (encrypted at rest)
  idDocumentNumberEncrypted?: string;
  // Plaintext is only used transiently on the client for validation; never persisted
  idDocumentNumber?: string;
  // Identification type and nationality
  idDocumentType?: 'ID Card' | 'Passport';
  nationalityCode?: string; // ISO 3166-1 alpha-2 (e.g., "US")
  nationalityName?: string; // resolved display name
  // Optional extended booking fields used by UI
  email?: string;
  phone?: string;
  roomPreference?: string;
  bookingName?: string;
  bookingType?: 'Individual' | 'Group' | string;
  // Booking source tracking
  bookingSource?: 'website' | 'agent' | 'referral' | 'walk-in' | 'ota' | string;
  partnerCode?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  // Client confirmation
  termsAccepted?: boolean;
  confirmedAt?: string; // ISO timestamp of confirmation
  signatureEncrypted?: string; // encrypted data URL for signature image
  paymentMethod?: 'Credit Card' | 'Cash' | string;
  settleAtCheckout?: boolean;
  paymentInfoSource?: string;
  paymentVerified?: boolean;
}

export interface ShiftReading {
  id: string;
  reading_number: number;
  reading_type: 'X' | 'Z';
  shift_id: string;
  outlet?: 'default' | 'restaurant' | 'bar';
  total_sales: number;
  total_transactions: number;
  bar_sales: number;
  restaurant_sales: number;
  cash_payments: number;
  card_payments: number;
  room_charge_payments: number;
  created_at: string;
  report_data?: {
    expectedCash?: number;
    closingCash?: number;
    cashDifference?: number;
  };
  companyName?: string;
  paymentMethod?: 'Credit Card' | 'Cash' | string;
  settleAtCheckout?: boolean;
  // Payment verification fields
  paymentInfoSource?: string;
  paymentVerified?: boolean;
}

export interface FolioCharge {
  id: string;
  guestId: string;
  description: string;
  amount: number;
  date: string;
  category: string;
}

export interface CityLedgerTransaction {
  id: string;
  date: string; // ISO date
  reference?: string;
  description: string;
  debit?: number; // charges
  credit?: number; // payments
}

export interface CityLedgerNote {
  id: string;
  date: string; // ISO date
  author?: string;
  text: string;
}

export interface CityLedgerAccount {
  id: string;
  name: string;
  type: 'Corporate' | 'Travel Agent' | 'Credit Card Company' | 'Banquet/Event' | 'Direct Bill' | string;
  creditLimit: number;
  balance: number;
  paymentTerms: string;
  status?: 'Active' | 'Closed' | 'On Hold';
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  address?: string;
  billingCycle?: 'Monthly' | 'Weekly' | 'Upon Checkout' | string;
  activatedOn?: string;
  transactions?: CityLedgerTransaction[];
  notes?: CityLedgerNote[];
}
