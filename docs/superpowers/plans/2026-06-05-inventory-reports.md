# Interactive Inventory Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Stock On Hand and Movement History report tabs inside the existing InventoryHub Reports tab, backed by two live-DB endpoints.

**Architecture:** Two new GET routes in `server/routes/inventory-v11.cjs` (shared router). A new `StockReports` component added inline to `src/components/modules/InventoryHub.tsx` replaces the existing `VarianceReports` call in `renderTab`. The existing Variance Report JSX is preserved as a sub-tab inside `StockReports`.

**Tech Stack:** Node.js/Express, `pg` pool.query (read-only), React 18 / TypeScript, Tailwind, shadcn/ui.

---

## File map

| File | Change |
|------|--------|
| `server/routes/inventory-v11.cjs` | Add `GET /report/stock-on-hand` and `GET /report/movement` routes |
| `src/components/modules/InventoryHub.tsx` | Add `StockReports` component; update `renderTab` case `'reports'` |

---

### Task 1: Add stock-on-hand and movement API endpoints

**Files:**
- Modify: `server/routes/inventory-v11.cjs` — append two new GET routes near the other balance/ledger endpoints (after `/balance/:location_id`, around line 1560)

- [ ] **Step 1: Find the insertion point**

  Open `server/routes/inventory-v11.cjs` and locate the comment block `// INVENTORY BALANCE & LEDGER Endpoints` (around line 1533). Append both new routes after the existing `/balance/:location_id` handler.

- [ ] **Step 2: Add `/report/stock-on-hand` route**

  ```js
  /**
   * GET /api/v1/inventory/report/stock-on-hand
   * Stock balance per item for a location as of a point in time.
   * Query: location_id (required), as_of (optional ISO timestamp, defaults to NOW)
   */
  router.get('/report/stock-on-hand', async (req, res) => {
    const { location_id } = req.query;
    const as_of = req.query.as_of || new Date().toISOString();
    if (!location_id) {
      return res.status(400).json({ ok: false, error: 'location_id is required' });
    }
    try {
      const result = await pool.query(
        `SELECT i.id,
                i.name,
                i.category,
                COALESCE(SUM(sl.quantity_change), 0) AS balance,
                i.base_uom_id AS uom
         FROM public.inv_items i
         LEFT JOIN public.inv_stock_ledger sl
           ON sl.item_id = i.id
           AND sl.location_id = $1
           AND sl.inserted_at <= $2::timestamptz
         GROUP BY i.id, i.name, i.category, i.base_uom_id
         ORDER BY i.category, i.name`,
        [location_id, as_of]
      );
      res.json({ ok: true, rows: result.rows, location_id, as_of });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  ```

- [ ] **Step 3: Add `/report/movement` route**

  ```js
  /**
   * GET /api/v1/inventory/report/movement
   * Stock ledger movement for a location between two dates.
   * Query: location_id (required), from (YYYY-MM-DD), to (YYYY-MM-DD)
   */
  router.get('/report/movement', async (req, res) => {
    const { location_id } = req.query;
    const from = req.query.from || new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const to   = req.query.to   || new Date().toISOString().split('T')[0];
    if (!location_id) {
      return res.status(400).json({ ok: false, error: 'location_id is required' });
    }
    try {
      const result = await pool.query(
        `SELECT sl.inserted_at::date AS date,
                i.name AS item_name,
                sl.ledger_type,
                sl.reference_number,
                sl.quantity_change,
                sl.base_uom_id AS uom,
                sl.posted_by,
                SUM(sl.quantity_change) OVER (
                  PARTITION BY sl.item_id
                  ORDER BY sl.inserted_at
                  ROWS UNBOUNDED PRECEDING
                ) AS running_balance
         FROM public.inv_stock_ledger sl
         JOIN public.inv_items i ON i.id = sl.item_id
         WHERE sl.location_id = $1
           AND sl.inserted_at >= $2::date
           AND sl.inserted_at < ($3::date + interval '1 day')
         ORDER BY sl.inserted_at DESC`,
        [location_id, from, to]
      );
      res.json({ ok: true, rows: result.rows, location_id, from, to });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  ```

- [ ] **Step 4: Build**

  ```
  npm run build
  ```
  Expected: `✓ built in ...` — no errors.

- [ ] **Step 5: Commit**

  ```
  git add server/routes/inventory-v11.cjs
  git commit -m "feat: add GET /report/stock-on-hand and /report/movement inventory endpoints"
  ```

---

### Task 2: Add StockReports component and wire into InventoryHub

**Files:**
- Modify: `src/components/modules/InventoryHub.tsx`

The file is large (~2264 lines). Add the `StockReports` component as a new function component just before the `// MAIN HUB` comment block (around line 2187). Then update `renderTab` to use it.

- [ ] **Step 1: Read the existing `VarianceReports` component**

  Read `src/components/modules/InventoryHub.tsx` starting from where `VarianceReports` is defined (search for `function VarianceReports` or `const VarianceReports`). You need the full JSX so you can embed it as a sub-tab inside `StockReports`.

- [ ] **Step 2: Add the CSV download helper**

  Find the helpers section near the top of InventoryHub.tsx (after the `apiPost` helper, around line 30). Add:

  ```ts
  function downloadCSV(filename: string, rows: Record<string, unknown>[], columns: string[]) {
    const header = columns.join(',');
    const body = rows.map(r => columns.map(c => JSON.stringify(r[c] ?? '')).join(',')).join('\n');
    const blob = new Blob([header + '\n' + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }
  ```

- [ ] **Step 3: Add the `StockReports` component**

  Insert the following component immediately before the `// ─── MAIN HUB ───` comment block:

  ```tsx
  // ─── STOCK REPORTS ───────────────────────────────────────────────────────────
  function StockReports({ data }: { data: ReturnType<typeof useInventoryData> }) {
    const { toast } = useToast();
    const [subTab, setSubTab] = React.useState<'onhand' | 'movement' | 'variance'>('onhand');

    // Stock On Hand state
    const [ohLocation, setOhLocation] = React.useState('');
    const [ohAsOf, setOhAsOf] = React.useState(new Date().toISOString().split('T')[0]);
    const [ohRows, setOhRows] = React.useState<any[]>([]);
    const [ohLoading, setOhLoading] = React.useState(false);

    // Movement state
    const [mvLocation, setMvLocation] = React.useState('');
    const [mvFrom, setMvFrom] = React.useState(new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]);
    const [mvTo, setMvTo] = React.useState(new Date().toISOString().split('T')[0]);
    const [mvRows, setMvRows] = React.useState<any[]>([]);
    const [mvLoading, setMvLoading] = React.useState(false);

    const runStockOnHand = async () => {
      if (!ohLocation) { toast({ title: 'Select a location', variant: 'destructive' }); return; }
      setOhLoading(true);
      try {
        const r = await fetch(`/api/v1/inventory/report/stock-on-hand?location_id=${ohLocation}&as_of=${ohAsOf}T23:59:59`);
        const d = await r.json();
        if (d.ok) setOhRows(d.rows);
        else toast({ title: 'Error', description: d.error, variant: 'destructive' });
      } catch (e: any) {
        toast({ title: 'Network error', description: e.message, variant: 'destructive' });
      } finally { setOhLoading(false); }
    };

    const runMovement = async () => {
      if (!mvLocation) { toast({ title: 'Select a location', variant: 'destructive' }); return; }
      setMvLoading(true);
      try {
        const r = await fetch(`/api/v1/inventory/report/movement?location_id=${mvLocation}&from=${mvFrom}&to=${mvTo}`);
        const d = await r.json();
        if (d.ok) setMvRows(d.rows);
        else toast({ title: 'Error', description: d.error, variant: 'destructive' });
      } catch (e: any) {
        toast({ title: 'Network error', description: e.message, variant: 'destructive' });
      } finally { setMvLoading(false); }
    };

    const SUB_TABS = [
      { id: 'onhand',   label: '📋 Stock On Hand' },
      { id: 'movement', label: '🔀 Movement' },
      { id: 'variance', label: '⚖ Variance' },
    ] as const;

    return (
      <div className="space-y-4">
        {/* Sub-tab bar */}
        <div className="flex gap-1 border-b pb-2">
          {SUB_TABS.map(t => (
            <button key={t.id} onClick={() => setSubTab(t.id as any)}
              className={`px-4 py-1.5 rounded-t text-sm font-medium transition-all ${
                subTab === t.id ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Stock On Hand */}
        {subTab === 'onhand' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Location</label>
                <select value={ohLocation} onChange={e => setOhLocation(e.target.value)}
                  className="border rounded px-2 py-1.5 text-sm min-w-[180px]">
                  <option value="">Select location…</option>
                  {(data.locations || []).map((l: any) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">As Of</label>
                <input type="date" value={ohAsOf} onChange={e => setOhAsOf(e.target.value)}
                  className="border rounded px-2 py-1.5 text-sm" />
              </div>
              <button onClick={runStockOnHand} disabled={ohLoading}
                className="px-4 py-1.5 bg-indigo-600 text-white rounded text-sm font-medium disabled:opacity-50">
                {ohLoading ? 'Running…' : 'Run Report'}
              </button>
              {ohRows.length > 0 && (
                <button onClick={() => downloadCSV(
                  `stock-onhand-${ohLocation}-${ohAsOf}.csv`,
                  ohRows,
                  ['id','name','category','balance','uom']
                )} className="px-4 py-1.5 border rounded text-sm font-medium text-gray-600 hover:bg-gray-50">
                  ⬇ Export CSV
                </button>
              )}
            </div>
            {ohRows.length > 0 && (
              <div className="overflow-x-auto rounded border">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-600">Item</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600">Category</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600">Balance</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600">UOM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ohRows.map((row, i) => (
                      <tr key={row.id} className={`border-b ${Number(row.balance) === 0 ? 'text-gray-400' : ''} ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                        <td className="px-4 py-2">{row.name}</td>
                        <td className="px-4 py-2 text-gray-500">{row.category}</td>
                        <td className="px-4 py-2 text-right font-mono">{fmtQ(Number(row.balance))}</td>
                        <td className="px-4 py-2 text-gray-500">{row.uom}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {ohRows.length === 0 && !ohLoading && (
              <p className="text-sm text-gray-400 text-center py-8">Select a location and run the report.</p>
            )}
          </div>
        )}

        {/* Movement */}
        {subTab === 'movement' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Location</label>
                <select value={mvLocation} onChange={e => setMvLocation(e.target.value)}
                  className="border rounded px-2 py-1.5 text-sm min-w-[180px]">
                  <option value="">Select location…</option>
                  {(data.locations || []).map((l: any) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">From</label>
                <input type="date" value={mvFrom} onChange={e => setMvFrom(e.target.value)}
                  className="border rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">To</label>
                <input type="date" value={mvTo} onChange={e => setMvTo(e.target.value)}
                  className="border rounded px-2 py-1.5 text-sm" />
              </div>
              <button onClick={runMovement} disabled={mvLoading}
                className="px-4 py-1.5 bg-indigo-600 text-white rounded text-sm font-medium disabled:opacity-50">
                {mvLoading ? 'Running…' : 'Run Report'}
              </button>
              {mvRows.length > 0 && (
                <button onClick={() => downloadCSV(
                  `movement-${mvLocation}-${mvFrom}-${mvTo}.csv`,
                  mvRows,
                  ['date','item_name','ledger_type','reference_number','quantity_change','uom','running_balance','posted_by']
                )} className="px-4 py-1.5 border rounded text-sm font-medium text-gray-600 hover:bg-gray-50">
                  ⬇ Export CSV
                </button>
              )}
            </div>
            {mvRows.length > 0 && (
              <div className="overflow-x-auto rounded border">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-600">Date</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600">Item</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600">Type</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600">Reference</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600">Qty Change</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600">Running Bal</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600">Posted By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mvRows.map((row, i) => (
                      <tr key={i} className={`border-b ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                        <td className="px-4 py-2 text-gray-500">{row.date}</td>
                        <td className="px-4 py-2">{row.item_name}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                            row.ledger_type?.includes('OUT') || row.ledger_type?.includes('ADJ') 
                              ? 'bg-red-50 text-red-700' 
                              : 'bg-green-50 text-green-700'
                          }`}>{row.ledger_type}</span>
                        </td>
                        <td className="px-4 py-2 text-gray-500 text-xs">{row.reference_number || '—'}</td>
                        <td className={`px-4 py-2 text-right font-mono ${Number(row.quantity_change) < 0 ? 'text-red-600' : 'text-green-700'}`}>
                          {Number(row.quantity_change) > 0 ? '+' : ''}{fmtQ(Number(row.quantity_change))}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-gray-700">{fmtQ(Number(row.running_balance))}</td>
                        <td className="px-4 py-2 text-gray-500 text-xs">{row.posted_by || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {mvRows.length === 0 && !mvLoading && (
              <p className="text-sm text-gray-400 text-center py-8">Select a location and date range, then run the report.</p>
            )}
          </div>
        )}

        {/* Variance — delegate to existing component */}
        {subTab === 'variance' && <VarianceReports data={data} />}
      </div>
    );
  }
  ```

- [ ] **Step 4: Update `renderTab` in `InventoryHub`**

  Find `case 'reports': return <VarianceReports data={data} />;` and change it to:

  ```tsx
  case 'reports':   return <StockReports      data={data} />;
  ```

- [ ] **Step 5: Build**

  ```
  npm run build
  ```
  Expected: `✓ built in ...` — no TypeScript errors. If `data.locations` is typed and `any[]` causes an error, cast as `(data.locations as any[] || [])`.

- [ ] **Step 6: Commit**

  ```
  git add src/components/modules/InventoryHub.tsx
  git commit -m "feat: add Stock On Hand and Movement sub-tabs to InventoryHub Reports"
  ```

---

### Task 3: Push and verify

- [ ] **Step 1: Push**

  ```
  git push
  ```

- [ ] **Step 2: Verify nav**

  Confirm the Reports tab in InventoryHub now shows three sub-tabs: Stock On Hand, Movement, Variance. Variance tab should render exactly as before.
