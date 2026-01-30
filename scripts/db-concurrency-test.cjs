// Simple PostgreSQL concurrency test for 3 terminals
// Usage:
//   node scripts/db-concurrency-test.cjs --url "postgres://user:pass@host:5432/db" [--clients 3]
// or set env: DATABASE_URL

const { Pool } = require('pg')

function parseArgs() {
  const args = process.argv.slice(2)
  const out = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--url') out.url = args[++i]
    else if (a === '--clients') out.clients = Number(args[++i] || 3)
  }
  return out
}

async function main() {
  const { url, clients = 3 } = parseArgs()
  const conn = url || process.env.DATABASE_URL
  if (!conn) {
    console.error('ERROR: Provide connection via --url or DATABASE_URL env')
    process.exit(1)
  }

  const pool = new Pool({ connectionString: conn, max: Math.max(10, clients) })
  const report = { config: {}, checks: {}, metrics: {}, results: {} }

  // Basic config checks
  try {
    const c = await pool.connect()
    try {
      const r1 = await c.query("SHOW max_connections")
      const r2 = await c.query("SHOW default_transaction_isolation")
      report.config.max_connections = r1.rows[0].max_connections
      report.config.default_isolation = r2.rows[0].default_transaction_isolation
    } finally { c.release() }
  } catch (e) {
    report.config.error = String(e.message || e)
  }

  // Ensure a test table exists (if permitted)
  let tableReady = false
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.concurrency_probe (
        id SERIAL PRIMARY KEY,
        payload TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    tableReady = true
  } catch (e) {
    report.checks.table_create_error = String(e.message || e)
  }

  // Baseline metrics
  try {
    const r = await pool.query(`SELECT datname, numbackends, xact_commit, xact_rollback, blks_read, blks_hit FROM pg_stat_database WHERE datname = current_database()`)   
    report.metrics.baseline = r.rows[0]
  } catch {}

  // Concurrency run: 3 clients performing transactions
  const runClient = async (id) => {
    const client = await pool.connect()
    const res = { id, steps: [] }
    const time = () => new Date().toISOString()
    try {
      await client.query('BEGIN')
      await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
      res.steps.push({ t: time(), msg: 'BEGIN' })

      if (tableReady) {
        const ins = await client.query('INSERT INTO public.concurrency_probe(payload) VALUES ($1) RETURNING id', [`client-${id}`])
        const rowId = ins.rows[0].id
        res.insertedId = rowId
        res.steps.push({ t: time(), msg: `INSERT id=${rowId}` })
        // Attempt to update same row from multiple clients to observe row locks
        const start = Date.now()
        await client.query('UPDATE public.concurrency_probe SET payload = $1, updated_at = NOW() WHERE id = $2', [`client-${id}-update`, rowId])
        const durationMs = Date.now() - start
        res.steps.push({ t: time(), msg: `UPDATE id=${rowId} durationMs=${durationMs}` })
      } else {
        // Fallback: a simple read-only workload
        await client.query('SELECT pg_sleep(0.1)')
        const r = await client.query('SELECT NOW() as now')
        res.steps.push({ t: time(), msg: `READ now=${r.rows[0].now}` })
      }

      await client.query('COMMIT')
      res.steps.push({ t: time(), msg: 'COMMIT' })
    } catch (e) {
      res.error = String(e.message || e)
      try { await client.query('ROLLBACK') } catch {}
      res.steps.push({ t: time(), msg: 'ROLLBACK' })
    } finally {
      client.release()
    }
    return res
  }

  const startTs = new Date().toISOString()
  const promises = []
  for (let i = 1; i <= clients; i++) promises.push(runClient(i))
  const results = await Promise.all(promises)
  report.results.clients = results
  report.results.started_at = startTs
  report.results.finished_at = new Date().toISOString()

  // Activity and locks snapshot
  try {
    const act = await pool.query(`SELECT state, wait_event_type, wait_event, query FROM pg_stat_activity WHERE datname = current_database()`)
    report.metrics.activity = act.rows
  } catch {}

  try {
    const r = await pool.query(`SELECT datname, numbackends, xact_commit, xact_rollback, blks_read, blks_hit FROM pg_stat_database WHERE datname = current_database()`)   
    report.metrics.post_run = r.rows[0]
  } catch {}

  await pool.end()
  console.log(JSON.stringify(report, null, 2))
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })

