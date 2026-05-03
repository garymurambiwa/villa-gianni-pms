// Offline-first cache system using IndexedDB for persistent storage
// Stores write operations when network is unavailable

export interface QueuedOperation {
    id: string;
    type: 'INSERT' | 'UPDATE' | 'DELETE';
    table: string;
    sql: string;
    params: any[];
    timestamp: number;
    userId?: string;
    metadata?: Record<string, any>;
    retryCount: number;
    status: 'pending' | 'syncing' | 'synced' | 'failed';
    error?: string;
}

export interface OfflineState {
    isOnline: boolean;
    lastOnline: number | null;
    pendingOperations: number;
    syncInProgress: boolean;
}

const DB_NAME = 'villa_gianni_offline_cache';
const DB_VERSION = 1;
const STORE_NAME = 'pending_operations';

class OfflineCache {
    private db: IDBDatabase | null = null;
    private initPromise: Promise<void> | null = null;

    async init(): Promise<void> {
        if (this.db) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                console.error('[OfflineCache] Failed to open IndexedDB:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('[OfflineCache] IndexedDB initialized successfully');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('status', 'status', { unique: false });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('table', 'table', { unique: false });
                    console.log('[OfflineCache] Object store created');
                }
            };
        });

        return this.initPromise;
    }

    async queueOperation(operation: Omit<QueuedOperation, 'id' | 'timestamp' | 'retryCount' | 'status'>): Promise<string> {
        await this.init();

        const id = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const queuedOp: QueuedOperation = {
            ...operation,
            id,
            timestamp: Date.now(),
            retryCount: 0,
            status: 'pending'
        };

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.add(queuedOp);

            request.onsuccess = () => {
                console.log(`[OfflineCache] Operation queued: ${id} (${operation.type} on ${operation.table})`);
                resolve(id);
            };

            request.onerror = () => {
                console.error('[OfflineCache] Failed to queue operation:', request.error);
                reject(request.error);
            };
        });
    }

    async getPendingOperations(): Promise<QueuedOperation[]> {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const index = store.index('status');
            const request = index.getAll('pending');

            request.onsuccess = () => {
                resolve(request.result || []);
            };

            request.onerror = () => {
                console.error('[OfflineCache] Failed to get pending operations:', request.error);
                reject(request.error);
            };
        });
    }

    async updateOperationStatus(id: string, status: QueuedOperation['status'], error?: string): Promise<void> {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const getRequest = store.get(id);

            getRequest.onsuccess = () => {
                const operation = getRequest.result;
                if (operation) {
                    operation.status = status;
                    if (error) operation.error = error;
                    if (status === 'failed') operation.retryCount++;

                    const putRequest = store.put(operation);
                    putRequest.onsuccess = () => resolve();
                    putRequest.onerror = () => reject(putRequest.error);
                } else {
                    resolve();
                }
            };

            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    async removeOperation(id: string): Promise<void> {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);

            request.onsuccess = () => {
                console.log(`[OfflineCache] Operation removed: ${id}`);
                resolve();
            };

            request.onerror = () => {
                console.error('[OfflineCache] Failed to remove operation:', request.error);
                reject(request.error);
            };
        });
    }

    async clearAll(): Promise<void> {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();

            request.onsuccess = () => {
                console.log('[OfflineCache] All operations cleared');
                resolve();
            };

            request.onerror = () => {
                console.error('[OfflineCache] Failed to clear operations:', request.error);
                reject(request.error);
            };
        });
    }

    async getOperationCount(): Promise<number> {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.count();

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                console.error('[OfflineCache] Failed to count operations:', request.error);
                reject(request.error);
            };
        });
    }

    async getPendingCount(): Promise<number> {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const index = store.index('status');
            const request = index.count('pending');

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                console.error('[OfflineCache] Failed to count pending operations:', request.error);
                reject(request.error);
            };
        });
    }
}

export const offlineCache = new OfflineCache();
export default offlineCache;
