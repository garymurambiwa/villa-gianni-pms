// Offline synchronization with conflict resolution
// Handles background sync of queued operations when network is restored

import { offlineCache, QueuedOperation } from './offlineCache';
import { networkStatus } from './networkStatus';
import { db } from './db';

export type ConflictStrategy = 'last-write-wins' | 'merge' | 'user-prompt';

export interface SyncResult {
    success: number;
    failed: number;
    conflicts: number;
    errors: string[];
}

export interface SyncProgress {
    total: number;
    completed: number;
    current: QueuedOperation | null;
    status: 'idle' | 'syncing' | 'completed' | 'failed';
}

type SyncProgressListener = (progress: SyncProgress) => void;

class OfflineSync {
    private syncInProgress: boolean = false;
    private listeners: Set<SyncProgressListener> = new Set();
    private conflictStrategy: ConflictStrategy = 'last-write-wins';
    private readonly MAX_RETRIES = 3;
    private readonly RETRY_DELAY = 2000; // 2 seconds

    constructor() {
        // Start monitoring network status
        networkStatus.startMonitoring();

        // Subscribe to network status changes
        networkStatus.subscribe((status) => {
            if (status === 'online' && !this.syncInProgress) {
                console.log('[OfflineSync] Network restored, starting sync...');
                this.syncAll();
            }
        });
    }

    setConflictStrategy(strategy: ConflictStrategy): void {
        this.conflictStrategy = strategy;
    }

    subscribe(listener: SyncProgressListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notifyListeners(progress: SyncProgress): void {
        this.listeners.forEach(listener => {
            try {
                listener(progress);
            } catch (error) {
                console.error('[OfflineSync] Error in listener:', error);
            }
        });
    }

    async syncAll(): Promise<SyncResult> {
        if (this.syncInProgress) {
            console.log('[OfflineSync] Sync already in progress');
            return { success: 0, failed: 0, conflicts: 0, errors: ['Sync already in progress'] };
        }

        if (!networkStatus.isOnline()) {
            console.log('[OfflineSync] Network is offline, skipping sync');
            return { success: 0, failed: 0, conflicts: 0, errors: ['Network is offline'] };
        }

        this.syncInProgress = true;
        const result: SyncResult = { success: 0, failed: 0, conflicts: 0, errors: [] };

        try {
            const pendingOperations = await offlineCache.getPendingOperations();

            if (pendingOperations.length === 0) {
                console.log('[OfflineSync] No pending operations to sync');
                this.notifyListeners({ total: 0, completed: 0, current: null, status: 'completed' });
                return result;
            }

            console.log(`[OfflineSync] Starting sync of ${pendingOperations.length} operations`);
            this.notifyListeners({ total: pendingOperations.length, completed: 0, current: null, status: 'syncing' });

            // Sort by timestamp to maintain order
            const sortedOperations = pendingOperations.sort((a, b) => a.timestamp - b.timestamp);

            for (let i = 0; i < sortedOperations.length; i++) {
                const operation = sortedOperations[i];

                this.notifyListeners({
                    total: sortedOperations.length,
                    completed: i,
                    current: operation,
                    status: 'syncing'
                });

                try {
                    await this.syncOperation(operation);
                    result.success++;
                    await offlineCache.removeOperation(operation.id);
                } catch (error: any) {
                    result.failed++;
                    const errorMessage = error.message || 'Unknown error';
                    result.errors.push(`Failed to sync ${operation.id}: ${errorMessage}`);

                    // Update operation status
                    await offlineCache.updateOperationStatus(operation.id, 'failed', errorMessage);

                    console.error(`[OfflineSync] Failed to sync operation ${operation.id}:`, error);
                }
            }

            this.notifyListeners({
                total: sortedOperations.length,
                completed: sortedOperations.length,
                current: null,
                status: result.failed > 0 ? 'failed' : 'completed'
            });

            console.log(`[OfflineSync] Sync completed: ${result.success} success, ${result.failed} failed`);
            return result;
        } catch (error: any) {
            console.error('[OfflineSync] Sync failed:', error);
            result.errors.push(error.message || 'Unknown error');
            this.notifyListeners({ total: 0, completed: 0, current: null, status: 'failed' });
            return result;
        } finally {
            this.syncInProgress = false;
        }
    }

    private async syncOperation(operation: QueuedOperation): Promise<void> {
        // Check if we should retry
        if (operation.retryCount >= this.MAX_RETRIES) {
            throw new Error(`Max retries (${this.MAX_RETRIES}) exceeded`);
        }

        // Add delay for retries
        if (operation.retryCount > 0) {
            await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY * operation.retryCount));
        }

        // Execute the operation
        const result = await db.query(operation.sql, operation.params);

        if ('error' in result) {
            throw new Error(result.error);
        }

        console.log(`[OfflineSync] Successfully synced operation ${operation.id}`);
    }

    async getPendingCount(): Promise<number> {
        return await offlineCache.getPendingCount();
    }

    async clearPending(): Promise<void> {
        await offlineCache.clearAll();
    }

    isSyncing(): boolean {
        return this.syncInProgress;
    }

    // Manual sync trigger
    async triggerSync(): Promise<SyncResult> {
        return this.syncAll();
    }
}

export const offlineSync = new OfflineSync();
export default offlineSync;
