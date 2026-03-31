import React, { useState, useEffect } from 'react';
import { networkStatus, NetworkStatus } from '../lib/networkStatus';
import { offlineSync } from '../lib/offlineSync';

interface OfflineIndicatorProps {
    className?: string;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({ className = '' }) => {
    const [networkStatusState, setNetworkStatusState] = useState<NetworkStatus>('online');
    const [pendingCount, setPendingCount] = useState(0);
    const [syncProgress, setSyncProgress] = useState<{ completed: number; total: number } | null>(null);
    const [showDetails, setShowDetails] = useState(false);

    useEffect(() => {
        // Subscribe to network status changes
        const unsubscribeNetwork = networkStatus.subscribe((status) => {
            setNetworkStatusState(status);
        });

        // Subscribe to sync progress
        const unsubscribeSync = offlineSync.subscribe((progress) => {
            if (progress.status === 'syncing') {
                setSyncProgress({ completed: progress.completed, total: progress.total });
            } else {
                setSyncProgress(null);
            }
        });

        // Update pending count periodically
        const updatePendingCount = async () => {
            const count = await offlineSync.getPendingCount();
            setPendingCount(count);
        };

        updatePendingCount();
        const interval = setInterval(updatePendingCount, 5000);

        return () => {
            unsubscribeNetwork();
            unsubscribeSync();
            clearInterval(interval);
        };
    }, []);

    const handleManualSync = async () => {
        if (networkStatusState === 'online') {
            await offlineSync.triggerSync();
        }
    };

    const getStatusColor = () => {
        switch (networkStatusState) {
            case 'online':
                return 'bg-green-500';
            case 'offline':
                return 'bg-red-500';
            case 'unstable':
                return 'bg-yellow-500';
            default:
                return 'bg-gray-500';
        }
    };

    const getStatusText = () => {
        switch (networkStatusState) {
            case 'online':
                return 'Online';
            case 'offline':
                return 'Offline';
            case 'unstable':
                return 'Unstable';
            default:
                return 'Unknown';
        }
    };

    const getStatusIcon = () => {
        switch (networkStatusState) {
            case 'online':
                return (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                );
            case 'offline':
                return (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                );
            case 'unstable':
                return (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                );
            default:
                return null;
        }
    };

    // Don't show indicator if online and no pending operations
    if (networkStatusState === 'online' && pendingCount === 0 && !syncProgress) {
        return null;
    }

    return (
        <div className={`fixed bottom-4 right-4 z-50 ${className}`}>
            <div
                className="flex items-center gap-2 px-4 py-2 rounded-lg shadow-lg cursor-pointer transition-all duration-300 hover:shadow-xl"
                style={{
                    backgroundColor: networkStatusState === 'online' ? '#10b981' :
                        networkStatusState === 'offline' ? '#ef4444' : '#f59e0b',
                    color: 'white'
                }}
                onClick={() => setShowDetails(!showDetails)}
            >
                <div className="flex items-center gap-2">
                    {getStatusIcon()}
                    <span className="font-medium text-sm">{getStatusText()}</span>
                    {pendingCount > 0 && (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-white/20">
                            {pendingCount} pending
                        </span>
                    )}
                </div>

                {syncProgress && (
                    <div className="flex items-center gap-2 ml-2">
                        <div className="w-16 h-1.5 bg-white/30 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-white rounded-full transition-all duration-300"
                                style={{ width: `${(syncProgress.completed / syncProgress.total) * 100}%` }}
                            />
                        </div>
                        <span className="text-xs">{syncProgress.completed}/{syncProgress.total}</span>
                    </div>
                )}
            </div>

            {showDetails && (
                <div className="absolute bottom-full right-0 mb-2 w-64 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden">
                    <div className="p-4">
                        <h3 className="font-semibold text-gray-800 mb-2">Connection Status</h3>

                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-600">Status:</span>
                                <span className={`font-medium ${networkStatusState === 'online' ? 'text-green-600' :
                                        networkStatusState === 'offline' ? 'text-red-600' : 'text-yellow-600'
                                    }`}>
                                    {getStatusText()}
                                </span>
                            </div>

                            {pendingCount > 0 && (
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Pending operations:</span>
                                    <span className="font-medium text-orange-600">{pendingCount}</span>
                                </div>
                            )}

                            {syncProgress && (
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Syncing:</span>
                                    <span className="font-medium text-blue-600">
                                        {syncProgress.completed}/{syncProgress.total}
                                    </span>
                                </div>
                            )}
                        </div>

                        {networkStatusState === 'offline' && (
                            <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                                <p className="font-medium">You're offline</p>
                                <p className="mt-1">Your changes are being saved locally and will sync when you're back online.</p>
                            </div>
                        )}

                        {networkStatusState === 'unstable' && (
                            <div className="mt-3 p-2 bg-orange-50 border border-orange-200 rounded text-xs text-orange-800">
                                <p className="font-medium">Unstable connection</p>
                                <p className="mt-1">Some operations may be delayed. Changes are being saved locally.</p>
                            </div>
                        )}

                        {pendingCount > 0 && networkStatusState === 'online' && (
                            <button
                                onClick={handleManualSync}
                                className="mt-3 w-full px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
                            >
                                Sync Now
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default OfflineIndicator;
