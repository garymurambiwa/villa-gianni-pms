import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { printDocument } from '@/lib/posIntegration';
import { buildFlashReport, buildPosReconciliation, buildPurchaseReceivingLog, buildMonthlyPL, buildAgedAR, buildInventoryCOGS, buildHousekeepingStatus, buildDailyTax, buildCashBankDeposits, buildTrialBalance, buildDepartmentalSummary, buildArrivalsDepartures, buildHighBalance, buildProcurementVariance, buildFixedAssetRecon, exportCSV, exportXLS, generateReportHTML, ReportType, exportMonthlyWorkbookXLS } from '@/lib/reporting';
import { useAuth } from '@/context/AuthContext';
import { canViewReport } from '@/lib/permissions';

const ReportingDashboard: React.FC = () => {
  const [reportType, setReportType] = React.useState<ReportType>('flash');
  const [dailyDate, setDailyDate] = React.useState<string>(new Date().toISOString().slice(0,10));
  const [month, setMonth] = React.useState<string>(new Date().toISOString().slice(0,7));
  const [threshold, setThreshold] = React.useState<number>(() => { try { const v = localStorage.getItem('corepms_high_balance_threshold'); return v ? Number(v) : 500; } catch { return 500; } });
  const [dataset, setDataset] = React.useState<{ title: string; columns: string[]; rows: any[] }>({ title: '', columns: [], rows: [] });
  const { user } = useAuth();

  const load = React.useCallback(() => {
    let data;
    switch (reportType) {
      case 'flash': data = buildFlashReport(dailyDate); break;
      case 'pos-recon': data = buildPosReconciliation(dailyDate); break;
      case 'purchase-log': data = buildPurchaseReceivingLog(dailyDate); break;
      case 'pl': data = buildMonthlyPL(month); break;
      case 'aged-ar': data = buildAgedAR(dailyDate); break;
      case 'inventory-cogs': data = buildInventoryCOGS(month); break;
      case 'housekeeping': data = buildHousekeepingStatus(); break;
      case 'daily-tax': data = buildDailyTax(dailyDate); break;
      case 'cash-bank': data = buildCashBankDeposits(dailyDate); break;
      case 'trial-balance': data = buildTrialBalance(month); break;
      case 'dept-summary': data = buildDepartmentalSummary(month); break;
      case 'arrivals-departures': data = buildArrivalsDepartures(dailyDate); break;
      case 'high-balance': data = buildHighBalance(threshold, dailyDate); break;
      case 'proc-variance': data = buildProcurementVariance(month); break;
      case 'fa-recon': data = buildFixedAssetRecon(month); break;
    }
    setDataset(data);
  }, [reportType, dailyDate, month]);

  React.useEffect(() => { load(); }, [load]);

  const exportPdf = () => {
    const html = generateReportHTML(dataset.title, dataset.columns, dataset.rows);
    printDocument(html, dataset.title, true);
  };
  const exportXlsx = () => exportXLS(dataset.columns, dataset.rows, dataset.title.replace(/\s+/g,'_'));
  const exportCsv = () => exportCSV(dataset.columns, dataset.rows, dataset.title.replace(/\s+/g,'_'));

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
  ].filter(o => allowed(o.key));

  // Consolidated monthly export
  const exportMonthBundle = () => exportMonthlyWorkbookXLS(month, `MonthEnd_${month}`);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={reportType} onValueChange={(v)=> setReportType(v as ReportType)}>
          <SelectTrigger className="w-60"><SelectValue placeholder="Select Report"/></SelectTrigger>
          <SelectContent>
            {reportOptions.map(o => (<SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>))}
          </SelectContent>
        </Select>
        {(reportType==='flash' || reportType==='pos-recon' || reportType==='purchase-log' || reportType==='aged-ar') && (
          <div className="flex items-center gap-2">
            <label className="text-xs">Business Date</label>
            <Input type="date" value={dailyDate} onChange={(e)=> setDailyDate(e.target.value)} />
          </div>
        )}
        {(reportType==='pl' || reportType==='inventory-cogs' || reportType==='trial-balance' || reportType==='dept-summary' || reportType==='proc-variance' || reportType==='fa-recon') && (
          <div className="flex items-center gap-2">
            <label className="text-xs">Month</label>
            <Input type="month" value={month} onChange={(e)=> setMonth(e.target.value)} />
          </div>
        )}
        {(reportType==='high-balance') && (
          <div className="flex items-center gap-2">
            <label className="text-xs">Threshold</label>
            <Input type="number" value={threshold} onChange={(e)=> { const v = Number(e.target.value || 0); setThreshold(v); try { localStorage.setItem('corepms_high_balance_threshold', String(v)); } catch {} }} />
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={exportPdf}>Print / Export PDF</Button>
          <Button variant="outline" onClick={exportXlsx}>Export XLS</Button>
          <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
          {(reportType==='pl' || reportType==='inventory-cogs' || reportType==='aged-ar') && (
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
