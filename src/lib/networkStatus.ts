// Network status detection and monitoring
// Provides real-time network connectivity status

export type NetworkStatus = 'online' | 'offline' | 'unstable';

export interface NetworkInfo {
    status: NetworkStatus;
    isOnline: boolean;
    lastChecked: number;
    latency: number | null;
    connectionType: string | null;
}

type NetworkStatusListener = (status: NetworkStatus) => void;

class NetworkStatusMonitor {
    private status: NetworkStatus = 'online';
    private listeners: Set<NetworkStatusListener> = new Set();
    private checkInterval: NodeJS.Timeout | null = null;
    private lastLatency: number | null = null;
    private consecutiveFailures: number = 0;
    private readonly CHECK_INTERVAL = 30000; // 30 seconds
    private readonly UNSTABLE_THRESHOLD = 3; // 3 consecutive failures = unstable

    constructor() {
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        if (typeof window !== 'undefined') {
            window.addEventListener('online', () => this.handleOnline());
            window.addEventListener('offline', () => this.handleOffline());

            // Initial status
            this.status = navigator.onLine ? 'online' : 'offline';
        }
    }

    private handleOnline(): void {
        console.log('[NetworkStatus] Browser detected online');
        this.consecutiveFailures = 0;
        this.updateStatus('online');
    }

    private handleOffline(): void {
        console.log('[NetworkStatus] Browser detected offline');
        this.updateStatus('offline');
    }

    private updateStatus(newStatus: NetworkStatus): void {
        if (this.status !== newStatus) {
            const oldStatus = this.status;
            this.status = newStatus;
            console.log(`[NetworkStatus] Status changed: ${oldStatus} -> ${newStatus}`);
            this.notifyListeners();
        }
    }

    private notifyListeners(): void {
        this.listeners.forEach(listener => {
            try {
                listener(this.status);
            } catch (error) {
                console.error('[NetworkStatus] Error in listener:', error);
            }
        });
    }

    async checkConnection(): Promise<NetworkInfo> {
        const startTime = Date.now();

        try {
            // Try to fetch a small resource to test actual connectivity
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch('https://www.google.com/favicon.ico', {
                method: 'HEAD',
                mode: 'no-cors',
                cache: 'no-store',
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            const latency = Date.now() - startTime;
            this.lastLatency = latency;
            this.consecutiveFailures = 0;

            // If latency is very high, consider connection unstable
            if (latency > 5000) {
                this.updateStatus('unstable');
            } else {
                this.updateStatus('online');
            }

            return {
                status: this.status,
                isOnline: true,
                lastChecked: Date.now(),
                latency,
                connectionType: (navigator as any).connection?.effectiveType || null
            };
        } catch (error) {
            this.consecutiveFailures++;

            if (this.consecutiveFailures >= this.UNSTABLE_THRESHOLD) {
                this.updateStatus('unstable');
            } else {
                this.updateStatus('offline');
            }

            return {
                status: this.status,
                isOnline: false,
                lastChecked: Date.now(),
                latency: null,
                connectionType: null
            };
        }
    }

    startMonitoring(): void {
        if (this.checkInterval) return;

        console.log('[NetworkStatus] Starting network monitoring');

        // Initial check
        this.checkConnection();

        // Periodic checks
        this.checkInterval = setInterval(() => {
            this.checkConnection();
        }, this.CHECK_INTERVAL);
    }

    stopMonitoring(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
            console.log('[NetworkStatus] Stopped network monitoring');
        }
    }

    subscribe(listener: NetworkStatusListener): () => void {
        this.listeners.add(listener);

        // Immediately notify with current status
        listener(this.status);

        // Return unsubscribe function
        return () => {
            this.listeners.delete(listener);
        };
    }

    getStatus(): NetworkStatus {
        return this.status;
    }

    isOnline(): boolean {
        return this.status === 'online';
    }

    isOffline(): boolean {
        return this.status === 'offline';
    }

    isUnstable(): boolean {
        return this.status === 'unstable';
    }

    getLatency(): number | null {
        return this.lastLatency;
    }
}

export const networkStatus = new NetworkStatusMonitor();
export default networkStatus;
