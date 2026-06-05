# Atomic Inventory Transfers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /api/v1/inventory/transfer/execute` to the shared inventory router so stock moves atomically in one DB transaction, then wire the dedicated transfer screen to call it.

**Architecture:** All inventory endpoints live in `server/routes/inventory-v11.cjs` (a shared Express router mounted by both `api/handler.js` and `server/index.cjs`). A new `/transfer/execute` handler runs one `BEGIN…COMMIT` block: advisory lock → balance check → header insert → lines insert → TRANSFER_OUT ledger → TRANSFER_IN ledger (with UOM conversion) → POS visibility sync → status='approved'. A local helper `buildTransferLineOps(client, line, headerId, sourceLocId, destLocId, transferNumber, actorId)` centralises the per-line steps and is reused by the existing `/transfer/:id/approve` handler to avoid drift.

**Tech Stack:** Node.js/CommonJS, `pg` pool (direct `pool.connect()` / `client.query()`), React 18 / TypeScript, Vite build.

---

## File map

| File | Change |
|------|--------|
| `server/routes/inventory-v11.cjs` | Add `executeTransferLines` helper + new `POST /transfer/execute` route (before `/transfer/:id/approve`); refactor `/transfer/:id/approve` to call the helper |
| `src/components/modules/InventoryV11Transfer.tsx` | Change `handleSubmit` to call `/transfer/execute`, map form fields to new request shape, update success toast |

---

### Task 1: Add `executeTransferLines` helper and new `/transfer/execute` route

**Files:**
- Modify: `server/routes/inventory-v11.cjs` — insert after line 1393 (end of `POST /transfer`), before line 1395 (`POST /transfer/:id/approve`)

- [ ] **Step 1: Open `server/routes/inventory-v11.cjs` and locate line 1393** (the `});` that closes `router.post('/transfer', ...)`). Confirm the next comment block starts at ~1395 with `POST /api/v1/inventory/transfer/:id/approve`.

- [ ] **Step 2: Insert the helper function and new route immediately after line 1393**

  Add this block (insert between the closing `});` of `/transfer` and the comment for `/transfer/:id/approve`):

  ```js
  /**
   * Shared helper — executes per-line transfer operations inside an active pg client transaction.
   * Performs advisory lock, balance check (throws on insufficient), TRANSFER_OUT + TRANSFER_IN
   * ledger inserts, and UOM breakdown conversion.
   * Caller is responsible for BEGIN/COMMIT/ROLLBACK and releasing the client.
   *
   * @param {object} client - active pg PoolClient
   * @param {object} line   - { item_id, qty_requested, source_uom_id, breakdown_flag, destination_uom_id }
   * @param {string} headerId
   * @param {string} sourceLocId
   * @param {string} destLocId
   * @param {string} transferNumber
   * @param {string} actorId - approved_by / created_by
   */
  async function executeTransferLines(client, lines, headerId, sourceLocId, destLocId, transferNumber, actorId) {
    for (const line of lines) {
      // Advisory lock per (item, source) — prevents concurrent over-deduction
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))`,
        [line.item_id, sourceLocId]
      );

      // Balance check
      const balRes = await client.query(
        `SELECT COALESCE(SUM(quantity_change), 0) AS balance
         FROM public.inv_stock_ledger
         WHERE item_id = $1 AND location_id = $2`,
        [line.item_id, sourceLocId]
      );
      const balance = Number(balRes.rows[0]?.balance || 0);
      const requested = Number(line.qty_requested);
      if (balance < requested) {
        throw new Error(
          `Insufficient stock for item ${line.item_id}: available ${balance.toFixed(3)}, requested ${requested.toFixed(3)}`
        );
      }

      // TRANSFER_OUT
      await client.query(
        `INSERT INTO public.inv_stock_ledger
         (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by, inserted_at)
         VALUES ($1,$2,$3,'TRANSFER_OUT',$4,$5,$6,$7,NOW())`,
        [randomUUID(), line.item_id, sourceLocId, transferNumber, -requested, line.source_uom_id, actorId]
      );

      // UOM conversion for destination
      let destQty = requested;
      const destUomId = line.destination_uom_id || line.source_uom_id;
      if (line.breakdown_flag && line.destination_uom_id && line.destination_uom_id !== line.source_uom_id) {
        const convRes = await client.query(
          `SELECT conversion_factor FROM public.inv_uom_conversions
           WHERE item_id=$1 AND from_uom_id=$2 AND to_uom_id=$3 AND breakdown_allowed=true`,
          [line.item_id, line.source_uom_id, line.destination_uom_id]
        );
        if (convRes.rows.length) {
          destQty = destQty * Number(convRes.rows[0].conversion_factor);
        } else {
          const globalConv = await client.query(
            `SELECT conversion_factor FROM public.inv_uom_conversions
             WHERE from_uom_id=$1 AND to_uom_id=$2 AND breakdown_allowed=true LIMIT 1`,
            [line.source_uom_id, line.destination_uom_id]
          );
          if (globalConv.rows.length) {
            destQty = destQty * Number(globalConv.rows[0].conversion_factor);
          }
        }
      }

      // TRANSFER_IN
      await client.query(
        `INSERT INTO public.inv_stock_ledger
         (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by, inserted_at)
         VALUES ($1,$2,$3,'TRANSFER_IN',$4,$5,$6,$7,NOW())`,
        [randomUUID(), line.item_id, destLocId, transferNumber, destQty, destUomId, actorId]
      );
    }
  }

  /**
   * POST /api/v1/inventory/transfer/execute
   * Atomic transfer: creates header + lines + posts TRANSFER_OUT and TRANSFER_IN in one transaction.
   * Body: { source_location_id, destination_location_id, created_by, reference_text?, items: [{item_id, qty_requested, source_uom_id, breakdown_flag?, destination_uom_id?}] }
   */
  router.post('/transfer/execute', async (req, res) => {
    const { source_location_id, destination_location_id, created_by, items } = req.body;
    const reference_text = req.body.reference_text || req.body.reference_note || null;

    if (!source_location_id || !destination_location_id || !created_by) {
      return res.status(400).json({ ok: false, error: 'Missing required fields: source_location_id, destination_location_id, created_by' });
    }
    if (source_location_id === destination_location_id) {
      return res.status(400).json({ ok: false, error: 'Source and destination locations must be different' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'items must be a non-empty array' });
    }
    for (const it of items) {
      if (!it.item_id || !(Number(it.qty_requested) > 0)) {
        return res.status(400).json({ ok: false, error: `Invalid line: item_id and qty_requested > 0 required` });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Transfer number
      const transCountRes = await client.query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(transfer_number FROM 12) AS INTEGER)), 0) + 1 AS next_num
         FROM public.inv_transfer_headers
         WHERE transfer_number ~ ('^TRANS-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-\\d+$')`
      );
      const nextNum = transCountRes.rows[0].next_num;
      const transferNumber = 'TRANS-' + new Date().getFullYear() + '-' + String(nextNum).padStart(4, '0');

      // Insert header (status = 'approved' immediately)
      let headerId;
      await client.query('SAVEPOINT th_exec');
      try {
        const hRes = await client.query(
          `INSERT INTO public.inv_transfer_headers
           (id, transfer_number, source_location_id, destination_location_id,
            from_location_id, to_location_id, created_by, reference_text,
            status, approved_by, approved_at, inserted_at)
           VALUES ($1,$2,$3,$4,$3,$4,$5,$6,'approved',$5,NOW(),NOW()) RETURNING id`,
          [randomUUID(), transferNumber, source_location_id, destination_location_id, created_by, reference_text]
        );
        await client.query('RELEASE SAVEPOINT th_exec');
        headerId = hRes.rows[0].id;
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT th_exec');
        const hRes = await client.query(
          `INSERT INTO public.inv_transfer_headers
           (id, transfer_number, from_location_id, to_location_id, status, inserted_at)
           VALUES ($1,$2,$3,$4,'approved',NOW()) RETURNING id`,
          [randomUUID(), transferNumber, source_location_id, destination_location_id]
        );
        headerId = hRes.rows[0].id;
      }

      // Insert lines
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await client.query(
          `INSERT INTO public.inv_transfer_lines
           (id, transfer_header_id, item_id, qty_requested, source_uom_id, breakdown_flag, destination_uom_id, line_number, inserted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
          [randomUUID(), headerId, it.item_id, it.qty_requested, it.source_uom_id || 'uom_bottle',
           it.breakdown_flag || false, it.destination_uom_id || null, i + 1]
        );
      }

      // Move stock (advisory lock + balance check + ledger entries)
      await executeTransferLines(client, items, headerId, source_location_id, destination_location_id, transferNumber, created_by);

      // POS visibility sync for destination outlet
      const destLoc = await client.query(
        `SELECT name, location_type FROM public.inv_locations WHERE id = $1`, [destination_location_id]
      );
      if (destLoc.rows.length) {
        const { name: locName, location_type } = destLoc.rows[0];
        if (location_type === 'Outlet') {
          const isBar        = /bar/i.test(locName);
          const isRestaurant = /restaurant|kitchen|room.service/i.test(locName);
          for (const it of items) {
            await client.query(`
              UPDATE public.products SET
                bar_visibility        = CASE WHEN $2 THEN true ELSE bar_visibility END,
                restaurant_visibility = CASE WHEN $3 THEN true ELSE restaurant_visibility END,
                active                = true,
                updated_at            = NOW()
              WHERE id = $1
            `, [it.item_id, isBar, isRestaurant]);
          }
        }
      }

      await client.query('COMMIT');
      res.json({ ok: true, transfer_id: headerId, transfer_number: transferNumber, lines_moved: items.length });
    } catch (error) {
      await client.query('ROLLBACK');
      const statusCode = error.message.startsWith('Insufficient stock') ? 409 : 500;
      res.status(statusCode).json({ ok: false, error: error.message });
    } finally {
      client.release();
    }
  });
  ```

- [ ] **Step 3: Refactor `/transfer/:id/approve` to use the helper**

  Inside `router.post('/transfer/:id/approve', ...)`, replace the entire per-line `for (const line of linesRes.rows)` loop (lines ~1425–1485, the balance check + TRANSFER_OUT + conversion + TRANSFER_IN blocks) with:

  ```js
  // Move stock using shared helper (advisory lock + balance check + ledger entries)
  await executeTransferLines(client, linesRes.rows, id, resolvedSource, resolvedDest, transfer.transfer_number, approved_by);
  ```

  Keep everything above (BEGIN, fetch transfer, fetch lines, resolvedSource/resolvedDest) and everything below (POS sync, status UPDATE, COMMIT) unchanged. Only replace the for-loop.

- [ ] **Step 4: Build to confirm no syntax errors**

  ```
  npm run build
  ```
  Expected: `✓ built in ...` with no TypeScript or module errors.

- [ ] **Step 5: Commit**

  ```
  git add server/routes/inventory-v11.cjs
  git commit -m "feat: add POST /transfer/execute atomic endpoint + shared executeTransferLines helper"
  ```

---

### Task 2: Fix the dedicated transfer screen to call the new endpoint

**Files:**
- Modify: `src/components/modules/InventoryV11Transfer.tsx` — `handleSubmit` function (lines 147–194)

- [ ] **Step 1: Replace the `handleSubmit` body in `InventoryV11Transfer.tsx`**

  Replace the existing `handleSubmit` function (lines 147–194) with:

  ```tsx
  const handleSubmit = async () => {
    if (!sourceLocation || !destinationLocation || lines.length === 0) {
      toast({
        title: 'Validation Error',
        description: 'Please fill all required fields and add at least one line item',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/v1/inventory/transfer/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_location_id: sourceLocation,
          destination_location_id: destinationLocation,
          created_by: 'current-user',
          reference_text: referenceText,
          items: lines.map(l => ({
            item_id: l.item_id,
            qty_requested: l.qty_requested,
            source_uom_id: l.source_uom_id,
            breakdown_flag: l.breakdown_flag,
            destination_uom_id: l.destination_uom_id,
          })),
        }),
      });

      const result = await response.json();

      if (result.ok) {
        toast({
          title: 'Transfer Complete',
          description: `Transfer ${result.transfer_number} executed — ${result.lines_moved} item(s) moved`,
        });
        setReferenceText('');
        setLines([]);
        // Refresh available stock for the source location
        if (sourceLocation) fetchAvailableStock();
      } else {
        throw new Error(result.error || 'Transfer failed');
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      toast({
        title: 'Transfer Failed',
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };
  ```

- [ ] **Step 2: Update the submit button label** — change the button text from `'Create Transfer'` to `'Execute Transfer'` and the loading text from `'Creating...'` to `'Executing...'` (line ~419):

  ```tsx
  {loading ? 'Executing...' : 'Execute Transfer'}
  ```

- [ ] **Step 3: Build**

  ```
  npm run build
  ```
  Expected: `✓ built in ...` with zero TypeScript errors.

- [ ] **Step 4: Commit**

  ```
  git add src/components/modules/InventoryV11Transfer.tsx
  git commit -m "fix: wire transfer screen to atomic /transfer/execute endpoint"
  ```

---

### Task 3: Manual smoke test

- [ ] **Step 1: Start the local dev server**

  ```
  npm run dev
  ```

- [ ] **Step 2: Navigate to the Stock Transfer screen** (Inventory → Transfer or the dedicated transfer module).

- [ ] **Step 3: Select a source location that has stock** and a different destination location.

- [ ] **Step 4: Add one item with qty = 1**, click **Execute Transfer**.

  Expected: success toast showing `Transfer TRANS-2026-XXXX executed — 1 item(s) moved`.

- [ ] **Step 5: Verify stock moved** — open the source location's balance page (or Inventory Hub) and confirm the item's balance decreased by 1. Open the destination location and confirm balance increased by 1.

- [ ] **Step 6: Test insufficient stock guard** — attempt to transfer more than the available balance of an item.

  Expected: error toast `Insufficient stock for item ...: available X, requested Y`. No ledger entries created.

- [ ] **Step 7: Push to deploy**

  ```
  git push
  ```

  Vercel and Render both serve from the shared `server/routes/inventory-v11.cjs` router. No additional endpoint duplication needed.

---

## Self-review against spec

| Spec requirement | Covered by |
|-----------------|-----------|
| One atomic DB transaction | Task 1 — single `BEGIN…COMMIT` |
| Advisory lock per (item, source) | Task 1 — `pg_advisory_xact_lock(hashtext($1 \|\| ':' \|\| $2))` |
| Balance check with 409 on insufficient | Task 1 — throws, catches as 409 |
| Header insert with `status='approved'` | Task 1 — header inserted directly as approved |
| Lines insert | Task 1 |
| TRANSFER_OUT + TRANSFER_IN ledger entries | Task 1 — `executeTransferLines` helper |
| UOM breakdown conversion | Task 1 — mirrored from existing approve logic |
| POS visibility sync for outlet destinations | Task 1 — mirrored from existing approve logic |
| Shared helper reused by old `/approve` | Task 1 step 3 |
| Frontend calls new endpoint | Task 2 |
| Backward compat — old `/transfer` + `/approve` kept | Not touched |
| Both backends covered | Shared router — one change covers both |
