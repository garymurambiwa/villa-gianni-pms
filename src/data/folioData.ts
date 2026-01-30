import { Folio, Transaction, Guest, Room, AuditTrailEntry } from "@/types/folio";
import { v4 as uuidv4 } from "uuid";

// Mock transactions
export const mockTransactions: Transaction[] = [
  {
    id: uuidv4(),
    folioId: "folio-1",
    amount: 150.00,
    description: "Room charge",
    date: new Date("2023-10-15T08:00:00"),
    type: "charge",
    createdBy: "staff-1",
    authorizationLevel: "staff"
  },
  {
    id: uuidv4(),
    folioId: "folio-1",
    amount: 45.50,
    description: "Restaurant charge",
    date: new Date("2023-10-15T19:30:00"),
    type: "charge",
    createdBy: "staff-2",
    authorizationLevel: "staff"
  },
  {
    id: uuidv4(),
    folioId: "folio-1",
    amount: -100.00,
    description: "Advance payment",
    date: new Date("2023-10-14T14:00:00"),
    type: "payment",
    createdBy: "staff-1",
    authorizationLevel: "staff"
  },
  {
    id: uuidv4(),
    folioId: "folio-2",
    amount: 200.00,
    description: "Room charge",
    date: new Date("2023-10-15T08:00:00"),
    type: "charge",
    createdBy: "staff-3",
    authorizationLevel: "staff"
  },
  {
    id: uuidv4(),
    folioId: "folio-2",
    amount: 25.00,
    description: "Mini bar",
    date: new Date("2023-10-15T21:15:00"),
    type: "charge",
    createdBy: "staff-2",
    authorizationLevel: "staff"
  }
];

// Mock folios
export const mockFolios: Folio[] = [
  {
    id: "folio-1",
    guestId: "guest-1",
    roomNumber: "101",
    createdAt: new Date("2023-10-14T12:00:00"),
    updatedAt: new Date("2023-10-15T19:30:00"),
    balance: 95.50,
    status: "open",
    transactions: mockTransactions.filter(t => t.folioId === "folio-1")
  },
  {
    id: "folio-2",
    guestId: "guest-2",
    roomNumber: "205",
    createdAt: new Date("2023-10-15T14:00:00"),
    updatedAt: new Date("2023-10-15T21:15:00"),
    balance: 225.00,
    status: "open",
    transactions: mockTransactions.filter(t => t.folioId === "folio-2")
  },
  {
    id: "folio-3",
    guestId: "guest-1",
    roomNumber: "101",
    createdAt: new Date("2023-09-20T12:00:00"),
    updatedAt: new Date("2023-09-25T11:00:00"),
    balance: 0,
    status: "closed",
    transactions: []
  }
];

// Mock guests
export const mockGuests: Guest[] = [
  {
    id: "guest-1",
    name: "John Smith",
    email: "john.smith@example.com",
    phone: "+1-555-123-4567",
    folios: mockFolios.filter(f => f.guestId === "guest-1")
  },
  {
    id: "guest-2",
    name: "Jane Doe",
    email: "jane.doe@example.com",
    phone: "+1-555-987-6543",
    folios: mockFolios.filter(f => f.guestId === "guest-2")
  }
];

// Mock rooms
export const mockRooms: Room[] = [
  {
    roomNumber: "101",
    type: "Deluxe King",
    status: "occupied",
    currentFolioId: "folio-1"
  },
  {
    roomNumber: "205",
    type: "Standard Queen",
    status: "occupied",
    currentFolioId: "folio-2"
  },
  {
    roomNumber: "302",
    type: "Suite",
    status: "vacant"
  }
];

// Mock audit trail
export const mockAuditTrail: AuditTrailEntry[] = [
  {
    id: uuidv4(),
    timestamp: new Date("2023-10-14T12:00:00"),
    userId: "staff-1",
    action: "CREATE",
    details: "Created new folio",
    entityType: "folio",
    entityId: "folio-1"
  },
  {
    id: uuidv4(),
    timestamp: new Date("2023-10-14T14:00:00"),
    userId: "staff-1",
    action: "CREATE",
    details: "Added payment transaction",
    entityType: "transaction",
    entityId: mockTransactions[2].id
  },
  {
    id: uuidv4(),
    timestamp: new Date("2023-10-15T08:00:00"),
    userId: "staff-1",
    action: "CREATE",
    details: "Added room charge",
    entityType: "transaction",
    entityId: mockTransactions[0].id
  }
];

// Helper functions for folio management
export const calculateFolioBalance = (folio: Folio): number => {
  return folio.transactions.reduce((total, transaction) => {
    // Void transactions don't count towards balance
    if (transaction.voidedBy) return total;
    
    // For charges, add to balance; for payments, subtract
    if (transaction.type === "charge" || transaction.type === "adjustment") {
      return total + transaction.amount;
    } else if (transaction.type === "payment") {
      return total + transaction.amount; // Amount should be negative for payments
    } else {
      return total;
    }
  }, 0);
};

export const getFolioById = (id: string): Folio | undefined => {
  return mockFolios.find(folio => folio.id === id);
};

export const getGuestById = (id: string): Guest | undefined => {
  return mockGuests.find(guest => guest.id === id);
};

export const getRoomByNumber = (roomNumber: string): Room | undefined => {
  return mockRooms.find(room => room.roomNumber === roomNumber);
};

export const getAuditTrailForEntity = (entityType: 'folio' | 'transaction', entityId: string): AuditTrailEntry[] => {
  return mockAuditTrail.filter(entry => entry.entityType === entityType && entry.entityId === entityId);
};