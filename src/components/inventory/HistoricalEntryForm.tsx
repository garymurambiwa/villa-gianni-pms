import React, { useEffect, useState } from 'react';
import { db } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { Loader2, Plus, Calendar, Package, DollarSign, Edit3, ChevronLeft, ChevronRight } from 'lucide-react';
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

    // Batch state
    const [selectedPeriod, setSelectedPeriod] = useState<string>('');
    const [lookupQuery, setLookupQuery] = useState('');
    const [departmentFilter, setDepartmentFilter] = useState('All');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState<string>('20');
    const [batchEntries, setBatchEntries] = useState<Record<string, { qty: string; price: string; date: string }>>({});
    const [bulkDate, setBulkDate] = useState<string>(new Date().toISOString().split('T')[0]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const pRes = await db.query("SELECT id, name FROM inventory_periods WHERE status != 'closed' ORDER BY end_date DESC");
            const periodList = pRes.rows || [];
            setPeriods(periodList);
            if (periodList.length > 0 && !selectedPeriod) {
                setSelectedPeriod(periodList[0].id);
            }
            
            const prodRes = await db.query("SELECT id, name, bar_visibility, restaurant_visibility FROM products WHERE is_stock_item = true ORDER BY name ASC");
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

    const updateEntry = (productId: string, field: 'qty' | 'price' | 'date', value: string) => {
        setBatchEntries(prev => ({
            ...prev,
            [productId]: {
                ...(prev[productId] || { qty: '', price: '', date: bulkDate }),
                [field]: value
            }
        }));
    };

    const handleBatchSubmit = async () => {
        if (!selectedPeriod) {
            toast.error('Please select a target period');
            return;
        }

        const entriesToSave = Object.entries(batchEntries).filter(([_, data]) => {
            return parseFloat(data.qty) > 0;
        });

        if (entriesToSave.length === 0) {
            toast.error('No valid entries to save (Qty must be > 0)');
            return;
        }

        setSubmitting(true);
        try {
            for (const [productId, data] of entriesToSave) {
                const id = uuidv4();
                const qtyVal = parseFloat(data.qty);
                const priceVal = parseFloat(data.price) || 0;
                const total = qtyVal * priceVal;
                
                await db.query(`
                    INSERT INTO inventory_transactions 
                    (id, period_id, product_id, type, quantity, unit_price, total_price, transaction_date, is_audit_backfill, created_by)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                `, [id, selectedPeriod, productId, 'purchase', qtyVal, priceVal, total, data.date || bulkDate, true, user?.id || 'system']);
            }

            toast.success(`Successfully logged ${entriesToSave.length} entries`);
            setBatchEntries({});
            fetchData();
        } catch (err: any) {
            toast.error(err.message || 'Failed to save entries');
        } finally {
            setSubmitting(false);
        }
    };

    const applyBulkDate = () => {
        const newEntries = { ...batchEntries };
        paginatedProducts.forEach(p => {
            if (newEntries[p.id]) {
                newEntries[p.id].date = bulkDate;
            }
        });
        setBatchEntries(newEntries);
        toast.info('Transaction dates updated for current page');
    };

    // Filter Logic
    let filteredProducts = products.filter(p => 
        p.name.toLowerCase().includes(lookupQuery.toLowerCase())
    );

    if (departmentFilter === 'Bar') {
        filteredProducts = filteredProducts.filter(p => p.bar_visibility);
    } else if (departmentFilter === 'Restaurant') {
        filteredProducts = filteredProducts.filter(p => p.restaurant_visibility);
    }

    // Pagination Logic
    const parsedItemsPerPage = itemsPerPage === 'All' ? filteredProducts.length : parseInt(itemsPerPage, 10) || 20;
    const totalPages = Math.max(1, Math.ceil(filteredProducts.length / parsedItemsPerPage));
    const safeCurrentPage = Math.min(currentPage, totalPages);
    
    // Reset page if filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [lookupQuery, departmentFilter, itemsPerPage]);

    const paginatedProducts = itemsPerPage === 'All' 
        ? filteredProducts 
        : filteredProducts.slice((safeCurrentPage - 1) * parsedItemsPerPage, safeCurrentPage * parsedItemsPerPage);

    if (loading) return <div className="flex justify-center py-10"><Loader2 className="h-10 w-10 animate-spin text-blue-500" /></div>;

    return (
        <div className="p-8 max-w-[1400px] mx-auto space-y-8 animate-in slide-in-from-bottom duration-500">
            <div className="flex justify-between items-start bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <div className="flex items-center gap-6">
                    <div className="h-12 w-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
                        <Plus className="text-white h-6 w-6" />
                    </div>
                    <div className="space-y-1">
                        <h2 className="text-3xl font-black text-slate-800 tracking-tight">Batch Backfill Entry</h2>
                        <p className="text-slate-400 font-medium">Log multiple purchases simultaneously across past periods.</p>
                    </div>
                </div>
                <div className="flex gap-3">
                    <Button variant="outline" onClick={() => window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module: 'inventory' } }))} className="rounded-2xl h-12 font-bold bg-slate-50 border-0 hover:bg-slate-100 px-6">
                        Dashboard
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                {/* Configuration Sidebar */}
                <Card className="lg:col-span-1 rounded-[2.5rem] shadow-xl border-t-8 border-t-blue-600 h-fit">
                    <CardHeader className="pb-0 pt-8 px-8">
                        <CardTitle className="text-xl font-black text-slate-800">Batch Controls</CardTitle>
                    </CardHeader>
                    <CardContent className="p-8 pt-6 space-y-6">
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
                            <p className="text-[10px] text-slate-400 font-bold px-1 italic">All entries will be assigned to this period.</p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-black uppercase text-slate-400 flex items-center gap-2">
                                <Calendar className="h-3 w-3" /> Default Transaction Date
                            </label>
                            <div className="flex gap-2">
                                <Input 
                                    type="date" 
                                    value={bulkDate} 
                                    onChange={(e) => setBulkDate(e.target.value)} 
                                    className="h-12 rounded-2xl border-2 border-slate-100 font-black"
                                />
                                <Button onClick={applyBulkDate} variant="outline" className="h-12 w-12 rounded-2xl border-2" title="Apply to active rows">
                                    <Edit3 className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-slate-100">
                            <Button 
                                disabled={submitting} 
                                onClick={handleBatchSubmit}
                                className="w-full h-14 rounded-2xl font-black text-lg bg-blue-600 hover:bg-blue-700 shadow-lg uppercase tracking-wider"
                            >
                                {submitting ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : 'Save All Entries'}
                            </Button>
                            <p className="text-[10px] text-center mt-3 font-bold text-slate-400 uppercase tracking-widest">
                                {Object.values(batchEntries).filter(e => parseFloat(e.qty) > 0).length} Ready to Save
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* Main Product Table */}
                <div className="lg:col-span-3 space-y-6">
                    <Card className="rounded-[2.5rem] shadow-xl overflow-hidden min-h-[600px] border-none">
                        <CardHeader className="bg-slate-50 border-b border-white p-6 flex flex-col lg:flex-row items-center justify-between gap-4">
                            <CardTitle className="text-xl font-black text-slate-800">Product List</CardTitle>
                            <div className="flex gap-3 w-full lg:w-auto">
                                <Select onValueChange={setDepartmentFilter} value={departmentFilter}>
                                    <SelectTrigger className="w-[160px] h-10 rounded-xl border-slate-200 bg-white font-bold">
                                        <SelectValue placeholder="Location" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl font-bold">
                                        <SelectItem value="All">All Locations</SelectItem>
                                        <SelectItem value="Bar">Bar Only</SelectItem>
                                        <SelectItem value="Restaurant">Restaurant Only</SelectItem>
                                    </SelectContent>
                                </Select>
                                <div className="relative flex-1 lg:w-64">
                                    <Package className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                    <Input 
                                        placeholder="Search products..." 
                                        value={lookupQuery}
                                        onChange={(e) => setLookupQuery(e.target.value)}
                                        className="pl-10 h-10 rounded-xl border-slate-200 bg-white font-bold w-full"
                                    />
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto min-h-[400px]">
                                <table className="w-full text-left">
                                    <thead className="bg-slate-100/50 text-[10px] uppercase font-black tracking-widest text-slate-400 border-b">
                                        <tr>
                                            <th className="px-6 py-4">Product Name</th>
                                            <th className="px-6 py-4 w-32 text-center">Qty Received</th>
                                            <th className="px-6 py-4 w-32 text-center">Unit Cost</th>
                                            <th className="px-6 py-4 w-44 text-center">Transaction Date</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {paginatedProducts.map(p => {
                                            const data = batchEntries[p.id] || { qty: '', price: '', date: bulkDate };
                                            return (
                                                <tr key={p.id} className={`hover:bg-blue-50/30 transition-colors ${parseFloat(data.qty) > 0 ? 'bg-blue-50/50' : ''}`}>
                                                    <td className="px-6 py-4 font-black text-slate-700">{p.name}</td>
                                                    <td className="px-6 py-4">
                                                        <Input 
                                                            type="number" 
                                                            placeholder="0"
                                                            value={data.qty}
                                                            onChange={(e) => updateEntry(p.id, 'qty', e.target.value)}
                                                            className="h-10 text-center font-black rounded-lg border-slate-200 focus:border-blue-500"
                                                        />
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <Input 
                                                            type="number" 
                                                            placeholder="0.00"
                                                            value={data.price}
                                                            onChange={(e) => updateEntry(p.id, 'price', e.target.value)}
                                                            className="h-10 text-center font-black rounded-lg border-slate-200 focus:border-blue-500"
                                                        />
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <Input 
                                                            type="date" 
                                                            value={data.date || bulkDate}
                                                            onChange={(e) => updateEntry(p.id, 'date', e.target.value)}
                                                            className="h-10 text-sm font-bold rounded-lg border-slate-200 focus:border-blue-500"
                                                        />
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {paginatedProducts.length === 0 && (
                                            <tr>
                                                <td colSpan={4} className="py-20 text-center text-slate-300 font-bold uppercase tracking-widest text-xs">
                                                    No products found matching filters.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                            
                            {/* Pagination Controls */}
                            <div className="flex items-center justify-between p-4 border-t border-slate-100 bg-slate-50/30">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-slate-400">Rows per page:</span>
                                    <Select onValueChange={setItemsPerPage} value={itemsPerPage}>
                                        <SelectTrigger className="h-8 w-[70px] rounded-lg border-slate-200 font-bold text-xs">
                                            <SelectValue placeholder="20" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-lg">
                                            <SelectItem value="15">15</SelectItem>
                                            <SelectItem value="20">20</SelectItem>
                                            <SelectItem value="50">50</SelectItem>
                                            <SelectItem value="All">All</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                
                                <div className="flex items-center gap-4">
                                    <span className="text-xs font-bold text-slate-400">
                                        Page {safeCurrentPage} of {totalPages} ({filteredProducts.length} items)
                                    </span>
                                    <div className="flex gap-1">
                                        <Button 
                                            variant="outline" 
                                            size="icon" 
                                            className="h-8 w-8 rounded-lg"
                                            disabled={safeCurrentPage === 1}
                                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        >
                                            <ChevronLeft className="h-4 w-4" />
                                        </Button>
                                        <Button 
                                            variant="outline" 
                                            size="icon" 
                                            className="h-8 w-8 rounded-lg"
                                            disabled={safeCurrentPage === totalPages}
                                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                        >
                                            <ChevronRight className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* History Section (Optional/Recent) */}
                    <Card className="rounded-[2.5rem] shadow-lg overflow-hidden border-none bg-slate-50/50">
                        <CardHeader className="p-8 pb-4">
                            <CardTitle className="text-lg font-black text-slate-800">Recent Audit History</CardTitle>
                        </CardHeader>
                        <CardContent className="px-8 pb-8">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {transactions.slice(0, 6).map(t => (
                                    <div key={t.id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex justify-between items-center">
                                        <div className="space-y-0.5">
                                            <div className="text-sm font-black text-slate-800">{t.product_name}</div>
                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                                                {t.quantity} Units • ${Number(t.total_price).toFixed(2)} • {new Date(t.transaction_date).toLocaleDateString()}
                                            </div>
                                        </div>
                                        <Badge variant="outline" className="text-[9px] h-5 bg-blue-100/50 text-blue-600 border-none font-black">LOGGED</Badge>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
};
