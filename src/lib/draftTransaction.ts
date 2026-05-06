/**
 * Draft Transaction Persistence Service
 * 
 * Implements the "Draft Transaction" pattern for robust state management:
 * - IndexedDB for client-side resilience
 * - Server-side staging table for cross-device synchronization
 * - Automatic recovery after logouts, page refreshes, session timeouts
 */

import { db } from './db';

export interface DraftTransaction {
  id: string; // UUID
  sessionId: string;
  userId: string;
  outlet: 'Restaurant' | 'Bar' | 'Conference';
  data: {
    cart: Array<{
      item: { id: string; name: string; price: number; category: string };
      qty: number;
      preparation_level?: string;
      manual_notes?: string;
    }>;
    customerName?: string;
    roomNumber?: string;
    customerName?: string;
    activeCategoryId?: string;
  };
  createdAt: string;
  updatedAt: string;
  version: number;
}

const DRAFT_STORE_NAME = 'draft_transactions';
const DB_NAME = 'PMS_DraftDB';
const DB_VERSION = 1;

export class DraftTransactionManager {
  private static instance: DraftTransactionManager;
  private dbInstance: IDBDatabase | null = null;
  private readonly DB_NAME = DB_NAME;
  private readonly STORE_NAME = DRAFT_STORE_NAME;
  private readonly SESSION_ID_KEY = 'corepms_draft_session_id';

  private constructor() {}

  static getInstance(): DraftTransactionManager {
    if (!DraftTransactionManager.instance) {
      DraftTransactionManager.instance = new DraftTransactionManager();
    }
    return DraftTransactionManager.instance;
  }

  /**
   * Initialize IndexedDB connection
   */
  async init(): Promise<void> {
    if (this.dbInstance) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[DraftTx] IndexedDB open failed');
        reject(request.error);
      };

      request.onsuccess = () => {
        this.dbInstance = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
          store.createIndex('by_session', 'sessionId', { unique: false });
          store.createIndex('by_user', 'userId', { unique: false });
          store.createIndex('by_outlet', 'outlet', { unique: false });
        }
      };
    });
  }

  /**
   * Save draft transaction locally (IndexedDB)
   */
  async saveLocal(draft: DraftTransaction): Promise<boolean> {
    try {
      await this.init();
      const tx = this.dbInstance!.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);

      const existing = await store.get(draft.id);
      const record = {
        ...draft,
        version: existing ? existing.version + 1 : 1,
        updatedAt: new Date().toISOString()
      };

      await store.put(record);
      await this.syncToServer(record);
      return true;
    } catch (err) {
      console.error('[DraftTx] Save local failed:', err);
      return false;
    }
  }

  /**
   * Load draft transaction from IndexedDB
   */
  async loadLocal(sessionId?: string): Promise<DraftTransaction | null> {
    try {
      await this.init();
      const sid = sessionId ?? this.getSessionId();
      const tx = this.dbInstance!.transaction(this.STORE_NAME, 'readonly');
      const index = tx.objectStore(this.STORE_NAME).index('by_session');
      
      return new Promise((resolve) => {
        const request = index.get(sid);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => resolve(null);
      });
    } catch (err) {
      console.error('[DraftTx] Load local failed:', err);
      return null;
    }
  }

  /**
   * Delete draft transaction (after successful completion)
   */
  async deleteDraft(id: string): Promise<boolean> {
    try {
      await this.init();
      const tx = this.dbInstance!.transaction(this.STORE_NAME, 'readwrite');
      await tx.objectStore(this.STORE_NAME).delete(id);
      
      // Also delete from server
      const isConfigured = await db.isConfigured();
      if (isConfigured) {
        await db.query('DELETE FROM draft_transactions WHERE id = $1', [id]);
      }
      return true;
    } catch (err) {
      console.error('[DraftTx] Delete failed:', err);
      return false;
    }
  }

  /**
   * Sync draft to server-side staging table
   */
  private async syncToServer(draft: DraftTransaction): Promise<void> {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) return;

    try {
      await db.query(`
        INSERT INTO draft_transactions (
          id, session_id, user_id, outlet, data, created_at, updated_at, version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          data = $5,
          updated_at = $7,
          version = $8
      `, [
        draft.id,
        draft.sessionId,
        draft.userId,
        draft.outlet,
        JSON.stringify(draft.data),
        draft.createdAt,
        draft.updatedAt,
        draft.version
      ]);
    } catch (err) {
      console.warn('[DraftTx] Server sync failed (non-critical):', err);
    }
  }

  /**
   * Sync from server on login/cross-device recovery
   */
  async syncFromServer(userId: string): Promise<DraftTransaction | null> {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) return null;

    try {
      const result = await db.query(
        'SELECT * FROM draft_transactions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
        [userId]
      );

      if ('rows' in result && result.rows.length > 0) {
        const row = result.rows[0];
        const draft: DraftTransaction = {
          id: row.id,
          sessionId: row.session_id,
          userId: row.user_id,
          outlet: row.outlet,
          data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          version: row.version
        };
        
        // Save to local IndexedDB
        await this.saveLocal(draft);
        return draft;
      }
    } catch (err) {
      console.warn('[DraftTx] Server sync failed:', err);
    }
    return null;
  }

  /**
   * Get or create session ID
   */
  getSessionId(): string {
    let sid = sessionStorage.getItem(this.SESSION_ID_KEY) ?? localStorage.getItem(this.SESSION_ID_KEY);
    if (!sid) {
      sid = `SESS_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      sessionStorage.setItem(this.SESSION_ID_KEY, sid);
      localStorage.setItem(this.SESSION_ID_KEY, sid);
    }
    return sid;
  }

  /**
   * Clear session (on explicit logout)
   */
  clearSession(): void {
    sessionStorage.removeItem(this.SESSION_ID_KEY);
  }

  /**
   * Recover drafts after page refresh/unexpected reload
   */
  async attemptRecovery(userId?: string): Promise<DraftTransaction | null> {
    try {
      // First try local IndexedDB
      const localDraft = await this.loadLocal();
      if (localDraft && localDraft.data?.cart?.length > 0) {
        return localDraft;
      }

      // Then try server if user is provided
      if (userId) {
        return await this.syncFromServer(userId);
      }

      return null;
    } catch (err) {
      console.error('[DraftTx] Recovery failed:', err);
      return null;
    }
  }
}

export const draftTx = DraftTransactionManager.getInstance();

// React hook for draft transaction management
import { useEffect, useState } from 'react';

export function useDraftTransaction(outlet: 'Restaurant' | 'Bar' | 'Conference' = 'Restaurant') {
  const [draft, setDraft] = useState<DraftTransaction | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initialize = async () => {
      setLoading(true);
      const recovered = await draftTx.attemptRecovery();
      if (recovered) {
        setDraft(recovered);
      }
      setLoading(false);
    };
    initialize();
  }, []);

  const save = async (cartData: any) => {
    const sessionId = draftTx.getSessionId();
    const draftTx_data: DraftTransaction = {
      id: draft?.id ?? `DRAFT_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      sessionId,
      userId: '', // Will be filled on save
      outlet,
      data: cartData,
      createdAt: draft?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: (draft?.version ?? 0) + 1
    };
    
    await draftTx.saveLocal(draftTx_data);
    setDraft(draftTx_data);
  };

  const clear = async () => {
    if (draft?.id) {
      await draftTx.deleteDraft(draft.id);
    }
    setDraft(null);
    draftTx.clearSession();
  };

  return { draft, save, clear, loading };
}