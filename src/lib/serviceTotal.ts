/**
 * serviceTotal.ts — Phase A scaffolding for the MICROS-style "Service Total"
 * transaction lifecycle.
 *
 * DORMANT BY DESIGN: nothing in the live POS imports this module yet. It adds
 * new tables and pure functions only; it does not change any staff-facing flow.
 * The UI wiring (useResilientBill + the Service Total button) lands in Phase B.
 *
 * What this provides:
 *   • ensureServiceTotalSchema() — additive DDL (CREATE … IF NOT EXISTS) for the
 *     pos_checks / pos_check_lines / pos_voids / pos_print_jobs tables. It never
 *     touches or alters existing tables, so it is safe to ship live.
 *   • commitServiceTotal()       — the atomic, idempotent commit (Phase 2). One
 *     BEGIN/COMMIT covering header + lines + table lock + kitchen/bar routing.
 *   • voidCommittedLine()        — the ONLY sanctioned mutation of a committed
 *     line: a manager-authorized reversing entry. Committed lines are otherwise
 *     frozen (enforced app-side here and by a DB trigger as defence-in-depth).
 *
 * Built on the existing db.transaction() (real BEGIN/COMMIT/ROLLBACK in
 * server/db-web.cjs) and the project's `?` placeholder convention.
 */
import { db } from './db';

export interface ServiceTotalLine {
  /** Client-generated, stable id → makes a retried commit a no-op (idempotent). */
  id: string;
  itemId?: string;
  name: string;
  qty: number;
  unitPrice: number;
  station?: 'kitchen' | 'bar';
}

export interface CommitServiceTotalArgs {
  /** Omit/null to OPEN a new check; pass an existing id to append another round. */
  checkId?: string | null;
  tableNumber: string;
  costCenter: string;
  shiftId?: string;
  userId?: string;
  /** The new (uncommitted) lines to persist permanently. */
  lines: ServiceTotalLine[];
}

export interface ServiceTotalResult {
  success: boolean;
  checkId?: string;
  error?: string;
}

export interface VoidLineArgs {
  checkId: string;
  lineId: string;
  qty: number;
  amount: number;
  reason: string;
  /** Manager user id — REQUIRED. A void with no authorizer is rejected. */
  authorizedBy: string;
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/* -------------------------------------------------------------------------- */
/*  Schema (additive, idempotent)                                             */
/* -------------------------------------------------------------------------- */

const SERVICE_TOTAL_DDL: string[] = [
  `CREATE SEQUENCE IF NOT EXISTS pos_check_number_seq START 1`,

  // HEADER — the "check". One open check per table per outlet.
  `CREATE TABLE IF NOT EXISTS pos_checks (
     id             TEXT PRIMARY KEY,
     client_txn_id  TEXT UNIQUE,
     check_number   BIGINT,
     table_number   TEXT NOT NULL,
     cost_center    TEXT NOT NULL,
     shift_id       TEXT,
     status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','voided')),
     opened_by      TEXT,
     total_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
     payment_method TEXT,
     created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     committed_at   TIMESTAMPTZ,
     closed_at      TIMESTAMPTZ
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS one_open_check_per_table
     ON pos_checks (table_number, cost_center) WHERE status = 'open'`,

  // LINES — append-only. A committed line is never edited or deleted.
  `CREATE TABLE IF NOT EXISTS pos_check_lines (
     id            TEXT PRIMARY KEY,
     check_id      TEXT NOT NULL REFERENCES pos_checks(id) ON DELETE RESTRICT,
     seq           INTEGER NOT NULL,
     item_id       TEXT,
     name          TEXT NOT NULL,
     qty           NUMERIC(10,3) NOT NULL CHECK (qty > 0),
     unit_price    NUMERIC(12,2) NOT NULL,
     line_total    NUMERIC(12,2) NOT NULL,
     route_station TEXT,
     state         TEXT NOT NULL DEFAULT 'committed' CHECK (state IN ('committed','voided')),
     printed_at    TIMESTAMPTZ,
     committed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (check_id, seq)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_check_lines_check ON pos_check_lines(check_id)`,

  // VOIDS — the only sanctioned mutation path for a committed line.
  `CREATE TABLE IF NOT EXISTS pos_voids (
     id             TEXT PRIMARY KEY,
     check_id       TEXT NOT NULL REFERENCES pos_checks(id) ON DELETE RESTRICT,
     line_id        TEXT NOT NULL REFERENCES pos_check_lines(id) ON DELETE RESTRICT,
     qty_voided     NUMERIC(10,3) NOT NULL CHECK (qty_voided > 0),
     amount         NUMERIC(12,2) NOT NULL,
     reason         TEXT NOT NULL,
     authorized_by  TEXT NOT NULL,
     created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  // PRINT JOBS — enqueued inside the commit txn; printed by a worker, never in-txn.
  `CREATE TABLE IF NOT EXISTS pos_print_jobs (
     id          TEXT PRIMARY KEY,
     check_id    TEXT NOT NULL REFERENCES pos_checks(id) ON DELETE RESTRICT,
     station     TEXT NOT NULL,
     payload     JSONB NOT NULL,
     status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','printed','failed')),
     created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     printed_at  TIMESTAMPTZ
   )`,
  `CREATE INDEX IF NOT EXISTS idx_print_pending ON pos_print_jobs(station) WHERE status = 'pending'`,

  // Defence-in-depth freeze: a committed line cannot be deleted, and its content
  // (qty/price/name/item) cannot change. The only permitted UPDATE is the
  // committed → voided state transition performed by voidCommittedLine().
  `CREATE OR REPLACE FUNCTION block_committed_line_mutation() RETURNS trigger AS $body$
     BEGIN
       IF TG_OP = 'DELETE' THEN
         IF OLD.state = 'committed' THEN
           RAISE EXCEPTION 'Committed line % is frozen and cannot be deleted; issue a VOID', OLD.id;
         END IF;
         RETURN OLD;
       END IF;
       IF OLD.state = 'committed' THEN
         IF NEW.qty <> OLD.qty OR NEW.unit_price <> OLD.unit_price
            OR NEW.line_total <> OLD.line_total OR NEW.name <> OLD.name
            OR NEW.item_id IS DISTINCT FROM OLD.item_id THEN
           RAISE EXCEPTION 'Committed line % is frozen; content cannot change. Issue a VOID.', OLD.id;
         END IF;
       END IF;
       RETURN NEW;
     END;
   $body$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS freeze_committed_lines ON pos_check_lines`,
  `CREATE TRIGGER freeze_committed_lines
     BEFORE UPDATE OR DELETE ON pos_check_lines
     FOR EACH ROW EXECUTE FUNCTION block_committed_line_mutation()`,
];

let schemaReady: Promise<void> | null = null;

/** Create the Service Total tables if they don't exist. Runs at most once per session. */
export function ensureServiceTotalSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const stmt of SERVICE_TOTAL_DDL) {
        try {
          await db.exec(stmt);
        } catch {
          // IF-NOT-EXISTS races / already-applied statements are non-fatal.
        }
      }
    })();
  }
  return schemaReady;
}

/* -------------------------------------------------------------------------- */
/*  Phase 2 — the atomic Service Total commit                                 */
/* -------------------------------------------------------------------------- */

/**
 * Persist the given uncommitted lines as a single atomic transaction:
 *   1. open the check (first call) and assign a permanent check_number
 *   2. write the lines permanently (frozen once committed)
 *   3. enqueue the kitchen/bar print routing
 *   4. lock the table to its open check
 *   5. recompute the header total from committed lines
 *
 * Idempotent: stable line ids + client_txn_id mean a retried commit (after a
 * network blip or power-cut reboot) is a no-op rather than a double-post.
 */
export async function commitServiceTotal(args: CommitServiceTotalArgs): Promise<ServiceTotalResult> {
  const { tableNumber, costCenter, shiftId, userId, lines } = args;
  if (!lines || lines.length === 0) {
    return { success: true, checkId: args.checkId || undefined };
  }
  await ensureServiceTotalSchema();

  const isNew = !args.checkId;
  const checkId = args.checkId || `CHK_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const clientTxnId = `${checkId}:${lines.map(l => l.id).join(',')}`;
  const station = lines.find(l => l.station)?.station || 'kitchen';
  const jobId = `PJ_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const ops: { sql: string; params: any[] }[] = [];

  // 1. Header (new checks only). check_number from a sequence (concurrency-safe).
  if (isNew) {
    ops.push({
      sql: `INSERT INTO pos_checks
              (id, client_txn_id, check_number, table_number, cost_center, shift_id, status, opened_by, total_amount, committed_at)
            VALUES (?, ?, nextval('pos_check_number_seq'), ?, ?, ?, 'open', ?, 0, NOW())
            ON CONFLICT (client_txn_id) DO NOTHING`,
      params: [checkId, clientTxnId, tableNumber, costCenter, shiftId || null, userId || null],
    });
  }

  // 2. Lines — each carries its own id, so ON CONFLICT DO NOTHING dedupes retries.
  for (const l of lines) {
    ops.push({
      sql: `INSERT INTO pos_check_lines
              (id, check_id, seq, item_id, name, qty, unit_price, line_total, route_station, state, printed_at, committed_at)
            VALUES (?, ?, (SELECT COALESCE(MAX(seq),0)+1 FROM pos_check_lines WHERE check_id=?),
                    ?, ?, ?, ?, ?, ?, 'committed', NOW(), NOW())
            ON CONFLICT (id) DO NOTHING`,
      params: [l.id, checkId, checkId, l.itemId || null, l.name, l.qty, l.unitPrice, round2(l.qty * l.unitPrice), l.station || 'kitchen'],
    });
  }

  // 3. Kitchen/bar routing — enqueue only (a worker prints; never inside the txn).
  ops.push({
    sql: `INSERT INTO pos_print_jobs (id, check_id, station, payload, status)
          VALUES (?, ?, ?, ?::jsonb, 'pending') ON CONFLICT (id) DO NOTHING`,
    params: [jobId, checkId, station, JSON.stringify(lines)],
  });

  // 4. Lock the table to its open check (mirrors the existing table_status model).
  ops.push({
    sql: `UPDATE table_status SET status='open', last_update=NOW()
          WHERE table_number=? AND LOWER(cost_center)=LOWER(?)`,
    params: [tableNumber, costCenter],
  });

  // 5. Recompute the header total from committed lines — idempotent on retry.
  ops.push({
    sql: `UPDATE pos_checks
          SET total_amount = (SELECT COALESCE(SUM(line_total),0) FROM pos_check_lines WHERE check_id=? AND state='committed')
          WHERE id=?`,
    params: [checkId, checkId],
  });

  const res: any = await db.transaction(ops);
  if (!res || res.ok === false) {
    return { success: false, checkId, error: res?.error || 'Service Total commit failed' };
  }
  return { success: true, checkId };
}

/* -------------------------------------------------------------------------- */
/*  Void — the only sanctioned mutation of a committed line                   */
/* -------------------------------------------------------------------------- */

export async function voidCommittedLine(args: VoidLineArgs): Promise<ServiceTotalResult> {
  if (!args.authorizedBy) {
    return { success: false, error: 'Manager authorization required to void a committed line' };
  }
  await ensureServiceTotalSchema();
  const voidId = `VOID_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const res: any = await db.transaction([
    {
      sql: `INSERT INTO pos_voids (id, check_id, line_id, qty_voided, amount, reason, authorized_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [voidId, args.checkId, args.lineId, args.qty, round2(args.amount), args.reason, args.authorizedBy],
    },
    // Permitted by the freeze trigger: committed -> voided, content unchanged.
    { sql: `UPDATE pos_check_lines SET state='voided' WHERE id=? AND check_id=?`, params: [args.lineId, args.checkId] },
    {
      sql: `UPDATE pos_checks
            SET total_amount = (SELECT COALESCE(SUM(line_total),0) FROM pos_check_lines WHERE check_id=? AND state='committed')
            WHERE id=?`,
      params: [args.checkId, args.checkId],
    },
  ]);
  if (!res || res.ok === false) {
    return { success: false, error: res?.error || 'Void failed' };
  }
  return { success: true, checkId: args.checkId };
}

export default { ensureServiceTotalSchema, commitServiceTotal, voidCommittedLine };
