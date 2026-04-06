import React, { useState, useEffect } from 'react';
import { InventoryDashboard } from '../inventory/InventoryDashboard';
import { ReconciliationWorksheet } from '../inventory/ReconciliationWorksheet';
import { HistoricalEntryForm } from '../inventory/HistoricalEntryForm';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

// Fallback for types if needed, but we mainly want to wrap the new logic
export const Inventory: React.FC = () => {
    const [subModule, setSubModule] = useState<'dashboard' | 'reconcile' | 'history'>('dashboard');
    const [activePeriodId, setActivePeriodId] = useState<string | null>(null);

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { module: string; props?: any };
            if (detail.module === 'inventory') {
                setSubModule('dashboard');
            } else if (detail.module === 'inventory-reconcile') {
                setSubModule('reconcile');
                setActivePeriodId(detail.props?.periodId || null);
            } else if (detail.module === 'inventory-history') {
                setSubModule('history');
            }
        };
        window.addEventListener('navigateToModule', handler as EventListener);
        return () => window.removeEventListener('navigateToModule', handler as EventListener);
    }, []);

    const renderHeader = () => (
        <div className="bg-white border-b border-slate-100 px-8 py-4 flex items-center justify-between shadow-sm sticky top-0 z-10">
            <div className="flex items-center gap-4">
                <div className="bg-blue-600 h-10 w-10 rounded-xl flex items-center justify-center shadow-md">
                    <span className="text-white text-xl font-black">INV</span>
                </div>
                <h1 className="text-2xl font-black text-slate-800 tracking-tight uppercase">Inventory Control</h1>
            </div>
            <Tabs value={subModule} onValueChange={(v: any) => setSubModule(v)} className="w-[450px]">
                <TabsList className="grid w-full grid-cols-3 bg-slate-100 p-1.5 h-12 rounded-2xl border-none">
                    <TabsTrigger value="dashboard" className="rounded-xl font-bold transition-all data-[state=active]:bg-white data-[state=active]:shadow-md">Periods</TabsTrigger>
                    <TabsTrigger value="history" className="rounded-xl font-bold transition-all data-[state=active]:bg-white data-[state=active]:shadow-md">Backfill</TabsTrigger>
                    <TabsTrigger value="live" className="rounded-xl font-bold transition-all data-[state=active]:bg-white data-[state=active]:shadow-md opacity-50 cursor-not-allowed">Live Stock</TabsTrigger>
                </TabsList>
            </Tabs>
        </div>
    );

    return (
        <div className="min-h-screen bg-[#FDFDFF]">
            {renderHeader()}
            
            <main className="max-w-[1600px] mx-auto">
                {subModule === 'dashboard' && <InventoryDashboard />}
                {subModule === 'history' && <HistoricalEntryForm />}
                {subModule === 'reconcile' && activePeriodId && (
                    <ReconciliationWorksheet periodId={activePeriodId} />
                )}
                {subModule === 'reconcile' && !activePeriodId && (
                    <div className="p-20 text-center space-y-4">
                        <div className="text-6xl">⚠️</div>
                        <h2 className="text-2xl font-black text-slate-800 ">No Period Selected</h2>
                        <p className="text-slate-400">Please select an inventory period from the dashboard to continue reconciliation.</p>
                    </div>
                )}
            </main>
        </div>
    );
};
