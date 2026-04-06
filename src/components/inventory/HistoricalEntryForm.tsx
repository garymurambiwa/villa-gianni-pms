import React, { useEffect, useState } from 'react';
import { db } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { Loader2, Plus, Calendar, Package, DollarSign, Edit3, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useAuth } from '@/context/AuthContext';

export const HistoricalEntryForm: React.FC = () => {
    const { user } = useAuth();
    const [periods, setPeriods] = useState<any[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    // Form state
    const [selectedPeriod, setSelectedPeriod] = useState<string>('');
    const [selectedProduct, setSelectedProduct] = useState<string>('');
    const [qty, setQty] = useState<string>('');
    const [price, setPrice] = useState<string>('');
    const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const pRes = await db.query("SELECT id, name FROM inventory_periods WHERE status != 'closed' ORDER BY end_date DESC");
            setPeriods(pRes.rows || []);
            
            const prodRes = await db.query("SELECT id, name FROM products WHERE is_stock_item = true ORDER BY name ASC");
            setProducts(prodRes.rows || []);

            const transRes = await db.query(`
                SELECT t.*, p.name as product_name, per.name as period_name 
                FROM inventory_transactions t
                JOIN products p ON t.product_id = p.id
                JOIN inventory_periods per ON t.period_id = per.id
                WHERE t.is_audit_backfill = true
                ORDER BY t.created_at DESC LIMIT 20
            `);
            setTransactions(transRes.rows || []);
        } catch (err) {
            toast.error('Failed to load form data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedPeriod || !selectedProduct || !qty || !date) {
            toast.error('Please fill all required fields');
            return;
        }

        setSubmitting(true);
        try {
            const id = uuidv4();
            const total = parseFloat(qty) * (parseFloat(price) || 0);
            
            await db.query(`
                INSERT INTO inventory_transactions 
                (id, period_id, product_id, type, quantity, unit_price, total_price, transaction_date, is_audit_backfill, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            `, [id, selectedPeriod, selectedProduct, 'purchase', parseFloat(qty), parseFloat(price) || 0, total, date, true, user?.id || 'system']);

            toast.success('Historical entry recorded');
            setQty('');
            setPrice('');
            fetchData();
        } catch (err: any) {
            toast.error(err.message || 'Failed to save entry');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <div className="flex justify-center py-10"><Loader2 className="h-10 w-10 animate-spin text-blue-500" /></div>;

    return (
        <div className="p-8 max-w-6xl mx-auto space-y-8 animate-in slide-in-from-bottom duration-500">
            <div className="flex justify-between items-center bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <div className="flex items-center gap-6">
                    <div className="h-12 w-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
                        <Plus className="text-white h-6 w-6" />
                    </div>
                    <div className="space-y-1">
                        <h2 className="text-3xl font-black text-slate-800 tracking-tight">Historical Transaction Entry</h2>
                        <p className="text-slate-400 font-medium">Log purchases for past inventory periods.</p>
                    </div>
                </div>
                <Button variant="outline" onClick={() => window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module: 'inventory' } }))} className="rounded-2xl h-12 font-bold bg-slate-50 border-0 hover:bg-slate-100 px-6">
                    Back to Dashboard
                </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <Card className="lg:col-span-1 rounded-[2.5rem] shadow-xl border-t-8 border-t-blue-600">
                    <CardHeader className="pb-0 pt-8 px-8">
                        <CardTitle className="text-xl font-black text-slate-800">Add Entry</CardTitle>
                    </CardHeader>
                    <CardContent className="p-8 pt-6">
                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div className="space-y-2">
                                <label className="text-xs font-black uppercase text-slate-400 flex items-center gap-2">
                                    <Calendar className="h-3 w-3" /> Target Period
                                </label>
                                <Select onValueChange={setSelectedPeriod} value={selectedPeriod}>
                                    <SelectTrigger className="h-12 rounded-2xl border-2 border-slate-100 focus:border-blue-500 bg-slate-50 font-black">
                                        <SelectValue placeholder="Select Period..." />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-2xl border-2">
                                        {periods.map(p => <SelectItem key={p.id} value={p.id} className="font-bold py-3">{p.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-black uppercase text-slate-400 flex items-center gap-2">
                                    <Package className="h-3 w-3" /> Product / Item
                                </label>
                                <Select onValueChange={setSelectedProduct} value={selectedProduct}>
                                    <SelectTrigger className="h-12 rounded-2xl border-2 border-slate-100 focus:border-blue-500 bg-slate-50 font-black">
                                        <SelectValue placeholder="Search Product..." />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-2xl border-2">
                                        {products.map(p => <SelectItem key={p.id} value={p.id} className="font-bold py-3">{p.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-black uppercase text-slate-400">Qty Received</label>
                                    <Input 
                                        type="number" 
                                        value={qty} 
                                        onChange={(e) => setQty(e.target.value)} 
                                        placeholder="0.00"
                                        className="h-12 rounded-2xl border-2 border-slate-100 font-black text-center"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-black uppercase text-slate-400">Unit Cost</label>
                                    <Input 
                                        type="number" 
                                        value={price} 
                                        onChange={(e) => setPrice(e.target.value)} 
                                        placeholder="0.00"
                                        className="h-12 rounded-2xl border-2 border-slate-100 font-black text-center"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-black uppercase text-slate-400">Transaction Date</label>
                                <Input 
                                    type="date" 
                                    value={date} 
                                    onChange={(e) => setDate(e.target.value)} 
                                    className="h-12 rounded-2xl border-2 border-slate-100 font-black"
                                />
                            </div>

                            <Button disabled={submitting} className="w-full h-14 rounded-2xl font-black text-lg bg-blue-600 hover:bg-blue-700 shadow-lg mt-4 uppercase tracking-wider">
                                {submitting ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : 'Log Entry'}
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                <div className="lg:col-span-2 space-y-6">
                    <Card className="rounded-[2.5rem] shadow-xl overflow-hidden min-h-[500px]">
                        <CardHeader className="bg-slate-50 border-b border-white p-8">
                            <CardTitle className="text-xl font-black text-slate-800">Recent Audit Entries</CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="divide-y divide-slate-100">
                                {transactions.map(t => (
                                    <div key={t.id} className="p-6 hover:bg-slate-50 transition-colors flex justify-between items-center group">
                                        <div className="flex gap-4">
                                            <div className="h-12 w-12 bg-white rounded-2xl flex items-center justify-center shadow-sm border border-slate-100 group-hover:border-blue-200 transition-colors">
                                                <DollarSign className="text-blue-500 h-5 w-5" />
                                            </div>
                                            <div className="space-y-1">
                                                <div className="text-lg font-black text-slate-800">{t.product_name}</div>
                                                <div className="flex gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest">
                                                    <span>{t.period_name}</span>
                                                    <span>•</span>
                                                    <span className="text-blue-500">{t.quantity} Units</span>
                                                    <span>•</span>
                                                    <span>{new Date(t.transaction_date).toLocaleDateString()}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-lg font-black text-slate-900">${Number(t.total_price).toFixed(2)}</div>
                                            <div className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-black uppercase tracking-widest inline-block">AUDIT_BACKFILL</div>
                                        </div>
                                    </div>
                                ))}
                                {transactions.length === 0 && (
                                    <div className="py-20 text-center text-slate-300 font-bold uppercase tracking-widest">No backfilled entries found.</div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
};
