// Folio management types

export type TransactionType = 'charge' | 'payment' | 'adjustment' | 'transfer' | 'void';

export type AuthorizationLevel = 'staff' | 'supervisor' | 'manager' | 'admin';

export interface Transaction {
  id: string;
  folioId: string;
  amount: number;
  description: string;
  date: Date;
  type: TransactionType;
  createdBy: string;
  voidedBy?: string;
  voidedAt?: Date;
  voidReason?: string;
  transferredTo?: string;
  transferredFrom?: string;
  authorizationLevel: AuthorizationLevel;
}

export interface AuditTrailEntry {
  id: string;
  timestamp: Date;
  userId: string;
  action: string;
  details: string;
  entityType: 'folio' | 'transaction';
  entityId: string;
}

export interface Folio {
  id: string;
  guestId: string;
  roomNumber: string;
  createdAt: Date;
  updatedAt: Date;
  balance: number;
  status: 'open' | 'closed' | 'pending';
  transactions: Transaction[];
  paymentMethod?: string;
}

export interface FolioSummary {
  id: string;
  guestName: string;
  roomNumber: string;
  balance: number;
  status: 'open' | 'closed' | 'pending';
  lastActivity: Date;
}

export interface Guest {
  id: string;
  name: string;
  email: string;
  phone: string;
  folios: Folio[];
}

export interface Room {
  roomNumber: string;
  type: string;
  status: 'occupied' | 'vacant' | 'dirty' | 'clean' | 'maintenance';
  currentFolioId?: string;
}