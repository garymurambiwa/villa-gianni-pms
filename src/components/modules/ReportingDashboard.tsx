import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { printDocument } from '@/lib/posIntegration';
import { buildFlashReport, buildPosReconciliation, buildPurchaseReceivingLog, buildMonthlyPL, buildAgedAR, buildInventoryCOGS, buildHousekeepingStatus, buildDailyTax, buildCashBankDeposits, buildTrialBalance, buildDepartmentalSummary, buildArrivalsDepartures, buildHighBalance, buildProcurementVariance, buildFixedAssetRecon, buildOpenBills, buildAgedPayables, buildPurchaseOrderHistory, buildPaymentHistory, buildVendorPaymentSummary, buildExpensesByDepartment, buildExpenseSummary, buildDetailedLineItemExport, exportCSV, exportXLS, generateReportHTML, ReportType, exportMonthlyWorkbookXLS } from '@/lib/reporting';
import { useAuth } from '@/context/AuthContext';
import { canViewReport } from '@/lib/permissions';

const ReportingDashboard: React.FC = () => {
  const [reportType, setReportType] = React.useState<ReportType>('flash');
  const [dailyDate, setDailyDate] = React.useState<string>(new Date().toISOString().slice(0, 10));
  const [month, setMonth] = React.useState<string>(new Date().toISOString().slice(0, 7));
  const [threshold, setThreshold] = React.useState<number>(() => { try { const v = localStorage.getItem('corepms_high_balance_threshold'); return v ? Number(v) : 500; } catch { return 500; } });
  const [dataset, setDataset] = React.useState<{ title: string; columns: string[]; rows: any[] }>({ title: '', columns: [], rows: [] });
  const { user } = useAuth();

  const load = React.useCallback(async () => {
    let data;
    switch (reportType) {
      case 'flash': {
        // Build from localStorage first
        data = buildFlashReport(dailyDate);
        // If all key metrics are zero, enrich from DB (backend night audit writes to DB, not localStorage)
        const hasNoData = data.rows.every((r: any) => !r.today || r.today === 0 || r.today === '0' || r.today === '$0.00');
        if (hasNoData) {
          try {
            const { db } = await import('@/lib/db');
            // Find the night_audit_runs row closest to the requested date
            const auditRes = await db.query<any>(
              `SELECT business_date::date as bd, rooms_posted, room_revenue, total_revenue, adr, revpar, occupancy_percent
               FROM night_audit_runs WHERE business_date::date <= $1 ORDER BY business_date DESC LIMIT 1`,
              [dailyDate]
            );
            const posRes = await db.query<any>(
              `SELECT COALESCE(SUM(total_amount),0) as pos_total, COUNT(*) as orders
               FROM pos_orders WHERE status='closed' AND created_at::date = $1`,
              [dailyDate]
            );
            if ('rows' in auditRes && auditRes.rows.length) {
              const a = auditRes.rows[0];
              const pos = 'rows' in posRes ? Number(posRes.rows[0]?.pos_total || 0) : 0;
              const roomRev = Number(a.room_revenue || 0);
              const totalRev = roomRev + pos;
              const occ = Number(a.occupancy_percent || 0);
              // Override the zero rows with DB values
              data = {
                ...data,
                rows: data.rows.map((r: any) => {
                  const m = String(r.metric || '').toLowerCase();
                  if (m.includes('room revenue'))    return { ...r, today: `$${roomRev.toFixed(2)}` };
                  if (m.includes('food revenue'))    return { ...r, today: `$${(pos * 0.6).toFixed(2)}` };
                  if (m.includes('bar revenue'))     return { ...r, today: `$${(pos * 0.4).toFixed(2)}` };
                  if (m.includes('f&b'))             return { ...r, today: `$${pos.toFixed(2)}` };
                  if (m.includes('total revenue'))   return { ...r, today: `$${totalRev.toFixed(2)}` };
                  if (m.includes('occupancy'))       return { ...r, today: `${occ.toFixed(1)}%` };
                  if (m.includes('adr'))             return { ...r, today: `$${Number(a.adr || 0).toFixed(2)}` };
                  if (m.includes('revpar'))          return { ...r, today: `$${Number(a.revpar || 0).toFixed(2)}` };
                  return r;
                })
              };
            }
          } catch (err) {
            console.warn('[ReportingDashboard] DB flash enrichment failed:', err);
          }
        }
        break;
      }
      case 'pos-recon': data = buildPosReconciliation(dailyDate); break;
      case 'purchase-log': data = buildPurchaseReceivingLog(dailyDate); break;
      case 'pl': data = buildMonthlyPL(month); break;
      case 'aged-ar': data = buildAgedAR(dailyDate); break;
      case 'inventory-cogs': data = buildInventoryCOGS(month); break;
      case 'housekeeping': data = buildHousekeepingStatus(); break;
      case 'daily-tax': data = buildDailyTax(dailyDate); break;
      case 'cash-bank': data = buildCashBankDeposits(dailyDate); break;
      case 'trial-balance': data = buildTrialBalance(month); break;
      case 'dept-summary': data = await buildDepartmentalSummary(month); break;
      case 'arrivals-departures': data = buildArrivalsDepartures(dailyDate); break;
      case 'high-balance': data = buildHighBalance(threshold, dailyDate); break;
      case 'proc-variance': data = buildProcurementVariance(month); break;
      case 'fa-recon': data = buildFixedAssetRecon(month); break;
      // Vendor reports
      case 'open-bills': data = buildOpenBills(); break;
      case 'aged-payables': data = buildAgedPayables(dailyDate); break;
      case 'po-history': data = buildPurchaseOrderHistory(month + '-01', month + '-31'); break;
      case 'payment-history': data = buildPaymentHistory(month + '-01', month + '-31'); break;
      case 'vendor-payment-summary': data = buildVendorPaymentSummary(month + '-01', month + '-31'); break;
      case 'expenses-by-dept': data = buildExpensesByDepartment(month + '-01', month + '-31'); break;
      case 'expense-summary-daily': data = buildExpenseSummary('daily', month + '-01', month + '-31'); break;
      case 'expense-summary-monthly': { const yr = month.slice(0, 4); data = buildExpenseSummary('monthly', yr + '-01-01', yr + '-12-31'); break; }
      case 'line-item-export': data = buildDetailedLineItemExport(month + '-01', month + '-31'); break;
    }
    if (data) setDataset(data);
  }, [reportType, dailyDate, month]);

  React.useEffect(() => { load(); }, [load]);

  // Auto-refresh when vendor data changes (expenses created/updated/deleted)
  React.useEffect(() => {
    const handleVendorUpdate = () => { load(); };
    window.addEventListener('vendor:data:updated', handleVendorUpdate);
    return () => window.removeEventListener('vendor:data:updated', handleVendorUpdate);
  }, [load]);

  const exportPdf = () => {
    const html = generateReportHTML(dataset.title, dataset.columns, dataset.rows);
    printDocument(html, dataset.title, true);
  };
  const exportXlsx = () => exportXLS(dataset.columns, dataset.rows, dataset.title.replace(/\s+/g, '_'));
  const exportCsv = () => exportCSV(dataset.columns, dataset.rows, dataset.title.replace(/\s+/g, '_'));

  const allowed = (key: ReportType) => canViewReport(key, user?.role);
  const reportOptions: Array<{ key: any; label: string }> = [
    { key: 'flash', label: "Daily: Manager's Flash" },
    { key: 'pos-recon', label: 'Daily: POS Sales/Cashier Reconciliation' },
    { key: 'purchase-log', label: 'Daily: Purchase & Receiving Log' },
    { key: 'housekeeping', label: 'Daily: Housekeeping Status' },
    { key: 'daily-tax', label: 'Daily: Tax Report' },
    { key: 'cash-bank', label: 'Daily: Cash & Bank Deposits' },
    { key: 'arrivals-departures', label: 'Daily: Arrivals & Departures' },
    { key: 'high-balance', label: 'Daily: High Balance' },
    { key: 'pl', label: 'Monthly: Profit & Loss (USALI)' },
    { key: 'aged-ar', label: 'Monthly: Aged Accounts Receivable' },
    { key: 'inventory-cogs', label: 'Monthly: Inventory & COGS' },
    { key: 'trial-balance', label: 'Monthly: Trial Balance' },
    { key: 'dept-summary', label: 'Monthly: Departmental Summary (USALI)' },
    { key: 'proc-variance', label: 'Monthly: Procurement Variance' },
    { key: 'fa-recon', label: 'Monthly: Fixed Asset Reconciliation' },
    // Vendor reports
    { key: 'open-bills', label: 'Vendor: Open Bills' },
    { key: 'aged-payables', label: 'Vendor: Aged Payables' },
    { key: 'po-history', label: 'Vendor: Purchase Order History' },
    { key: 'payment-history', label: 'Vendor: Payment History & Check Register' },
    { key: 'vendor-payment-summary', label: 'Vendor: Payment Summary by Vendor' },
    { key: 'expenses-by-dept', label: 'Vendor: Expenses by Department' },
    { key: 'expense-summary-daily', label: 'Vendor: Daily Expense Summary' },
    { key: 'expense-summary-monthly', label: 'Vendor: Monthly Expense Summary' },
    { key: 'line-item-export', label: 'Vendor: Detailed Line-Item Export' },
  ].filter(o => allowed(o.key));

  // Consolidated monthly export
  const exportMonthBundle = () => exportMonthlyWorkbookXLS(month, `MonthEnd_${month}`);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={reportType} onValueChange={(v) => setReportType(v as ReportType)}>
          <SelectTrigger className="w-60"><SelectValue placeholder="Select Report" /></SelectTrigger>
          <SelectContent>
            {reportOptions.map(o => (<SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>))}
          </SelectContent>
        </Select>
        {(reportType === 'flash' || reportType === 'pos-recon' || reportType === 'purchase-log' || reportType === 'aged-ar') && (
          <div className="flex items-center gap-2">
            <label className="text-xs">Business Date</label>
            <Input type="date" value={dailyDate} onChange={(e) => setDailyDate(e.target.value)} />
          </div>
        )}
        {(reportType === 'pl' || reportType === 'inventory-cogs' || reportType === 'trial-balance' || reportType === 'dept-summary' || reportType === 'proc-variance' || reportType === 'fa-recon') && (
          <div className="flex items-center gap-2">
            <label className="text-xs">Month</label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
        )}
        {(reportType === 'high-balance') && (
          <div className="flex items-center gap-2">
            <label className="text-xs">Threshold</label>
            <Input type="number" value={threshold} onChange={(e) => { const v = Number(e.target.value || 0); setThreshold(v); try { localStorage.setItem('corepms_high_balance_threshold', String(v)); } catch { } }} />
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={exportPdf}>Print / Export PDF</Button>
          <Button variant="outline" onClick={exportXlsx}>Export XLS</Button>
          <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
          {(reportType === 'pl' || reportType === 'inventory-cogs' || reportType === 'aged-ar') && (
            <Button className="bg-indigo-600 text-white" onClick={exportMonthBundle}>Export All (Month End)</Button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>{dataset.columns.map(c => (<th key={c} className="p-2 text-left border-b">{c}</th>))}</tr></thead>
          <tbody>
            {dataset.rows.length === 0 && (
              <tr><td className="p-2 text-gray-600" colSpan={dataset.columns.length || 1}>No data for the selected period.</td></tr>
            )}
            {dataset.rows.map((r, idx) => (
              <tr key={idx}>
                {dataset.columns.map(c => (<td key={c} className="p-2 border-b">{String((r as any)[c.toLowerCase()] ?? (r as any)[c] ?? '')}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ReportingDashboard;
