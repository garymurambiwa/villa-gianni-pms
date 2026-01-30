import { Client } from 'pg'
import fs from 'node:fs'
import path from 'node:path'

function parseArgs() {
  const args = process.argv.slice(2)
  const out = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--url') out.url = args[++i]
    else if (a === '--host') out.host = args[++i]
    else if (a === '--port') out.port = Number(args[++i])
    else if (a === '--db') out.database = args[++i]
    else if (a === '--user') out.user = args[++i]
    else if (a === '--password') out.password = args[++i]
  }
  return out
}

async function loadDotenv() {
  try {
    const env = process.env.NODE_ENV || 'development'
    const candidates = [
      env === 'production' ? '.env.production' : '.env.development',
      '.env'
    ]
    const dotenv = await import('dotenv')
    for (const file of candidates) {
      const p = path.resolve(process.cwd(), file)
      if (fs.existsSync(p)) {
        dotenv.config({ path: p })
        break
      }
    }
  } catch {}
}

async function main() {
  await loadDotenv()
  const args = parseArgs()
  const url = args.url || process.env.DATABASE_URL
  let client
  if (url) {
    client = new Client({ connectionString: url })
  } else {
    const host = args.host || process.env.PGHOST || 'localhost'
    const port = args.port || Number(process.env.PGPORT || 5432)
    const database = args.database || process.env.PGDATABASE || 'corepms_db'
    const user = args.user || process.env.PGUSER || 'postgres'
    const password = args.password || process.env.PGPASSWORD || 'postgres'
    client = new Client({ host, port, database, user, password })
  }

  const report = { input: {}, status: {}, details: {} }
  report.input = client.connectionParameters

  try {
    await client.connect()
    const r1 = await client.query('SELECT version() AS version, current_database() AS db, current_user AS user')
    const r2 = await client.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name LIMIT 20")
    const r3 = await client.query('SELECT NOW() AS now')
    let r4
    try {
      r4 = await client.query("SELECT username, role, active, password_change_required, two_factor_enabled FROM public.app_users WHERE lower(username) = lower('admin')")
    } catch {}
    // Basic integrity checks
    const requiredTables = ['app_users','access_logs','email_verifications','login_attempts','profiles','admins','reservations','guests','rooms','printer_configs']
    const tablesRes = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
    const present = new Set(tablesRes.rows.map(x => x.table_name))
    const missing = requiredTables.filter(t => !present.has(t))
    const fkRes = await client.query("SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name FROM information_schema.table_constraints AS tc JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='public'")
    const rlsRes = await client.query("SELECT n.nspname AS schema, c.relname AS table, c.relrowsecurity AS rls_enabled FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'")
    report.status.connected = true
    report.details.server = r1.rows[0]
    report.details.sample_tables = r2.rows.map((x) => x.table_name)
    report.details.now = r3.rows[0].now
    if (r4 && r4.rows && r4.rows[0]) {
      report.details.admin = r4.rows[0]
    }
    report.details.required_tables_missing = missing
    report.details.foreign_keys = fkRes.rows
    report.details.rls = rlsRes.rows
  } catch (e) {
    report.status.connected = false
    report.status.error = String(e.message || e)
  } finally {
    try { await client.end() } catch {}
  }

  console.log(JSON.stringify(report, null, 2))
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
