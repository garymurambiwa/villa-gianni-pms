/**
 * POS Integration Hooks
 * 
 * This file contains custom React hooks extracted from the POS system that can be
 * integrated into the main PMS system. Each hook is documented with its purpose,
 * parameters, and integration notes.
 */

import { useState, useEffect, useCallback, useContext, createContext } from 'react';
import { 
  generateTransactionId, 
  calculateBillTotal, 
  updateEntity,
  createAuditEntry 
} from '../lib/posIntegration';

// ============================================================================
// TYPES FOR HOOKS
// ============================================================================

interface Bill {
  id: string;
  items: BillItem[];
  subtotal: number;
  tax: number;
  total: number;
  status: 'open' | 'paid' | 'cancelled';
  createdAt: string;
  customerName?: string;
  roomNumber?: string;
  tableId?: string;
}

interface BillItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  subtotal: number;
  category?: string;
}

interface Entity {
  id: string;
  name: string;
  status: string;
  currentBill?: Bill;
  [key: string]: any;
}

interface PaymentData {
  billId: string;
  amount: number;
  paymentMethod: 'cash' | 'card' | 'room-charge';
  customerName?: string;
  roomNumber?: string;
  processedBy?: string;
}

// ============================================================================
// BILL MANAGEMENT HOOK
// ============================================================================

/**
 * Bill Management Hook
 * 
 * Manages bill/folio state and operations including:
 * - Creating and updating bills
 * - Adding/removing items
 * - Calculating totals
 * - Processing payments
 * 
 * Integration Notes:
 * - Adapt for folio management in PMS
 * - Use for room service orders, restaurant charges
 * - Integrate with existing charge posting system
 * - Add validation for room charges and guest verification
 */
export const useBillManagement = (taxRate: number = 0.10) => {
  const [bills, setBills] = useState<Bill[]>([]);
  const [activeBill, setActiveBill] = useState<Bill | null>(null);

  // Create new bill
  const createBill = useCallback((
    entityId: string, 
    customerInfo?: { name?: string; roomNumber?: string }
  ): Bill => {
    const newBill: Bill = {
      id: generateTransactionId('BILL'),
      items: [],
      subtotal: 0,
      tax: 0,
      total: 0,
      status: 'open',
      createdAt: new Date().toISOString(),
      tableId: entityId,
      customerName: customerInfo?.name,
      roomNumber: customerInfo?.roomNumber
    };

    setBills(prev => [...prev, newBill]);
    setActiveBill(newBill);
    return newBill;
  }, []);

  // Add item to bill
  const addItemToBill = useCallback((
    billId: string, 
    item: Omit<BillItem, 'id' | 'subtotal'>
  ) => {
    setBills(prev => prev.map(bill => {
      if (bill.id !== billId) return bill;

      const existingItemIndex = bill.items.findIndex(
        existing => existing.name === item.name && existing.price === item.price
      );

      let updatedItems;
      if (existingItemIndex >= 0) {
        // Update existing item quantity
        updatedItems = bill.items.map((existing, index) => 
          index === existingItemIndex 
            ? { 
                ...existing, 
                quantity: existing.quantity + item.quantity,
                subtotal: (existing.quantity + item.quantity) * existing.price
              }
            : existing
        );
      } else {
        // Add new item
        const newItem: BillItem = {
          ...item,
          id: generateTransactionId('ITEM'),
          subtotal: item.price * item.quantity
        };
        updatedItems = [...bill.items, newItem];
      }

      const newTotal = calculateBillTotal(updatedItems, taxRate);
      const subtotal = newTotal / (1 + taxRate);
      const tax = newTotal - subtotal;

      const updatedBill = {
        ...bill,
        items: updatedItems,
        subtotal: Number(subtotal.toFixed(2)),
        tax: Number(tax.toFixed(2)),
        total: newTotal
      };

      // Update active bill if it's the one being modified
      if (activeBill?.id === billId) {
        setActiveBill(updatedBill);
      }

      return updatedBill;
    }));
  }, [activeBill, taxRate]);

  // Remove item from bill
  const removeItemFromBill = useCallback((billId: string, itemIndex: number) => {
    setBills(prev => prev.map(bill => {
      if (bill.id !== billId) return bill;

      const updatedItems = bill.items.filter((_, index) => index !== itemIndex);
      const newTotal = calculateBillTotal(updatedItems, taxRate);
      const subtotal = newTotal / (1 + taxRate);
      const tax = newTotal - subtotal;

      const updatedBill = {
        ...bill,
        items: updatedItems,
        subtotal: Number(subtotal.toFixed(2)),
        tax: Number(tax.toFixed(2)),
        total: newTotal
      };

      if (activeBill?.id === billId) {
        setActiveBill(updatedBill);
      }

      return updatedBill;
    }));
  }, [activeBill, taxRate]);

  // Process payment for bill
  const processBillPayment = useCallback((
    billId: string, 
    paymentData: PaymentData
  ) => {
    setBills(prev => prev.map(bill => 
      bill.id === billId 
        ? { ...bill, status: 'paid' as const }
        : bill
    ));

    // Clear active bill if it was paid
    if (activeBill?.id === billId) {
      setActiveBill(null);
    }

    // Return payment confirmation
    return {
      transactionId: generateTransactionId('PAY'),
      billId,
      amount: paymentData.amount,
      processedAt: new Date().toISOString(),
      ...paymentData
    };
  }, [activeBill]);

  // Get bill by ID
  const getBillById = useCallback((billId: string) => {
    return bills.find(bill => bill.id === billId);
  }, [bills]);

  // Get bills by status
  const getBillsByStatus = useCallback((status: Bill['status']) => {
    return bills.filter(bill => bill.status === status);
  }, [bills]);

  return {
    bills,
    activeBill,
    setActiveBill,
    createBill,
    addItemToBill,
    removeItemFromBill,
    processBillPayment,
    getBillById,
    getBillsByStatus
  };
};

// ============================================================================
// ENTITY MANAGEMENT HOOK (TABLES/ROOMS)
// ============================================================================

/**
 * Entity Management Hook
 * 
 * Manages entity state (tables, rooms, etc.) including:
 * - Status updates
 * - Bill associations
 * - Availability tracking
 * - Bulk operations
 * 
 * Integration Notes:
 * - Use for room management in PMS
 * - Adapt for different entity types (rooms, tables, etc.)
 * - Integrate with housekeeping status updates
 * - Add reservation and check-in/out functionality
 */
export const useEntityManagement = <T extends Entity>(initialEntities: T[] = []) => {
  const [entities, setEntities] = useState<T[]>(initialEntities);

  // Update entity
  const updateEntityStatus = useCallback((
    entityId: string, 
    updates: Partial<T>
  ) => {
    setEntities(prev => updateEntity(prev, entityId, updates));
  }, []);

  // Bulk update entities
  const bulkUpdateEntities = useCallback((
    entityIds: string[], 
    updates: Partial<T>
  ) => {
    setEntities(prev => prev.map(entity => 
      entityIds.includes(entity.id) 
        ? { ...entity, ...updates }
        : entity
    ));
  }, []);

  // Get entities by status
  const getEntitiesByStatus = useCallback((status: string) => {
    return entities.filter(entity => entity.status === status);
  }, [entities]);

  // Get available entities
  const getAvailableEntities = useCallback(() => {
    return entities.filter(entity => entity.status === 'available');
  }, [entities]);

  // Associate bill with entity
  const associateBillWithEntity = useCallback((
    entityId: string, 
    bill: Bill | null
  ) => {
    updateEntityStatus(entityId, { currentBill: bill } as Partial<T>);
  }, [updateEntityStatus]);

  // Get entity by ID
  const getEntityById = useCallback((entityId: string) => {
    return entities.find(entity => entity.id === entityId);
  }, [entities]);

  return {
    entities,
    setEntities,
    updateEntityStatus,
    bulkUpdateEntities,
    getEntitiesByStatus,
    getAvailableEntities,
    associateBillWithEntity,
    getEntityById
  };
};

// ============================================================================
// RECEIPT SETTINGS HOOK
// ============================================================================

interface ReceiptSettings {
  restaurant_name: string;
  address?: string;
  phone?: string;
  email?: string;
  tax_rate: number;
  show_tax_breakdown: boolean;
  paper_size: '58mm' | '80mm';
  logo_url?: string;
  header_text?: string;
  footer_text?: string;
  promotional_message?: string;
}

/**
 * Receipt Settings Hook
 * 
 * Manages receipt/document settings including:
 * - Branding information
 * - Tax rates and display options
 * - Paper size and formatting
 * - Promotional messages
 * 
 * Integration Notes:
 * - Use for hotel document templates (folios, receipts, confirmations)
 * - Integrate with hotel branding and property information
 * - Add support for multiple languages/currencies
 * - Store settings in database for persistence
 */
export const useReceiptSettings = (locationId?: string) => {
  const [settings, setSettings] = useState<ReceiptSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load settings (integrate with your database/API)
  const loadSettings = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const brand = readReceiptBranding()
      const s: ReceiptSettings = {
        restaurant_name: brand.restaurant_name,
        address: brand.address || '',
        phone: brand.phone || '',
        email: brand.email || '',
        website: brand.website || '',
        tax_rate: Number(brand.tax_rate || 0),
        show_tax_breakdown: true,
        paper_size: (brand.paper_size as any) || '80mm',
        header_text: brand.header_text || '',
        footer_text: brand.footer_text || '',
        promotional_message: brand.promotional_message || ''
      }
      setSettings(s)
    } catch (err) {
      setError('Failed to load receipt settings')
      console.error('Receipt settings error:', err)
    } finally { setLoading(false) }
  }, [locationId])

  // Update settings
  const updateSettings = useCallback(async (newSettings: Partial<ReceiptSettings>) => {
    if (!settings) return;

    try {
      const updatedSettings = { ...settings, ...newSettings };
      
      // Replace with your actual API call
      // await api.updateReceiptSettings(locationId, updatedSettings);
      
      setSettings(updatedSettings);
      return updatedSettings;
    } catch (err) {
      setError('Failed to update receipt settings');
      console.error('Settings update error:', err);
      throw err;
    }
  }, [settings]);

  // Load settings on mount or locationId change
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return {
    settings,
    loading,
    error,
    updateSettings,
    reloadSettings: loadSettings
  };
};

// ============================================================================
// AUDIT TRAIL HOOK
// ============================================================================

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  userId: string;
  timestamp: string;
  details?: string;
}

/**
 * Audit Trail Hook
 * 
 * Manages audit logging for operations including:
 * - Transaction logging
 * - User action tracking
 * - Entity change history
 * - Compliance reporting
 * 
 * Integration Notes:
 * - Use for all PMS operations requiring audit trails
 * - Integrate with user authentication system
 * - Store audit logs in secure, immutable storage
 * - Add filtering and search capabilities for compliance
 */
export const useAuditTrail = (userId?: string) => {
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);

  // Log audit entry
  const logAuditEntry = useCallback((
    action: string,
    entityType: string,
    entityId: string,
    details?: any
  ) => {
    if (!userId) return;

    const entry = createAuditEntry(action, entityType, entityId, userId, details);
    setAuditEntries(prev => [entry, ...prev]);

    // In a real implementation, you would also send this to your backend
    // api.createAuditEntry(entry);

    return entry;
  }, [userId]);

  // Get audit entries for entity
  const getAuditEntriesForEntity = useCallback((
    entityType: string, 
    entityId: string
  ) => {
    return auditEntries.filter(
      entry => entry.entityType === entityType && entry.entityId === entityId
    );
  }, [auditEntries]);

  // Get audit entries by action
  const getAuditEntriesByAction = useCallback((action: string) => {
    return auditEntries.filter(entry => entry.action === action);
  }, [auditEntries]);

  // Get recent audit entries
  const getRecentAuditEntries = useCallback((limit: number = 50) => {
    return auditEntries.slice(0, limit);
  }, [auditEntries]);

  return {
    auditEntries,
    logAuditEntry,
    getAuditEntriesForEntity,
    getAuditEntriesByAction,
    getRecentAuditEntries
  };
};

// ============================================================================
// COMBINED POS CONTEXT HOOK
// ============================================================================

interface POSContextType {
  // Bill management
  bills: Bill[];
  activeBill: Bill | null;
  createBill: (entityId: string, customerInfo?: { name?: string; roomNumber?: string }) => Bill;
  addItemToBill: (billId: string, item: Omit<BillItem, 'id' | 'subtotal'>) => void;
  processBillPayment: (billId: string, paymentData: PaymentData) => any;
  
  // Entity management
  entities: Entity[];
  updateEntityStatus: (entityId: string, updates: Partial<Entity>) => void;
  getAvailableEntities: () => Entity[];
  
  // Settings
  receiptSettings: ReceiptSettings | null;
  updateReceiptSettings: (settings: Partial<ReceiptSettings>) => Promise<ReceiptSettings | undefined>;
  
  // Audit trail
  logAuditEntry: (action: string, entityType: string, entityId: string, details?: any) => AuditEntry | undefined;
}

const POSContext = createContext<POSContextType | undefined>(undefined);

/**
 * Combined POS Context Provider
 * 
 * Provides all POS functionality in a single context including:
 * - Bill management
 * - Entity management
 * - Receipt settings
 * - Audit trail logging
 * 
 * Integration Notes:
 * - Use as main context for POS-related functionality in PMS
 * - Wrap relevant components with this provider
 * - Customize initial data loading for your specific needs
 * - Add error handling and loading states as needed
 */
export const POSProvider: React.FC<{ 
  children: React.ReactNode;
  initialEntities?: Entity[];
  locationId?: string;
  userId?: string;
}> = ({ 
  children, 
  initialEntities = [], 
  locationId,
  userId 
}) => {
  const billManagement = useBillManagement();
  const entityManagement = useEntityManagement(initialEntities);
  const receiptSettings = useReceiptSettings(locationId);
  const auditTrail = useAuditTrail(userId);

  const contextValue: POSContextType = {
    // Bill management
    bills: billManagement.bills,
    activeBill: billManagement.activeBill,
    createBill: billManagement.createBill,
    addItemToBill: billManagement.addItemToBill,
    processBillPayment: billManagement.processBillPayment,
    
    // Entity management
    entities: entityManagement.entities,
    updateEntityStatus: entityManagement.updateEntityStatus,
    getAvailableEntities: entityManagement.getAvailableEntities,
    
    // Settings
    receiptSettings: receiptSettings.settings,
    updateReceiptSettings: receiptSettings.updateSettings,
    
    // Audit trail
    logAuditEntry: auditTrail.logAuditEntry
  };

  return (
    <POSContext.Provider value={contextValue}>
      {children}
    </POSContext.Provider>
  );
};

/**
 * Hook to use POS context
 * 
 * @returns POSContextType with all POS functionality
 * @throws Error if used outside POSProvider
 */
export const usePOS = (): POSContextType => {
  const context = useContext(POSContext);
  if (context === undefined) {
    throw new Error('usePOS must be used within a POSProvider');
  }
  return context;
};

// ============================================================================
// EXPORT ALL HOOKS
// ============================================================================

export default {
  useBillManagement,
  useEntityManagement,
  useReceiptSettings,
  useAuditTrail,
  POSProvider,
  usePOS
};
import { readReceiptBranding } from '@/lib/printSettings'
