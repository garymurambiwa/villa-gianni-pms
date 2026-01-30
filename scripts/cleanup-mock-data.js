const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

function findConfig() {
  try {
    const appData = process.env.APPDATA || process.env.LOCALAPPDATA || path.join(process.env.HOME||'', 'AppData', 'Roaming')
    const p1 = path.join(appData, 'Core DPMS', 'corepms', 'db_config.json')
    if (fs.existsSync(p1)) return JSON.parse(fs.readFileSync(p1,'utf8')).connectionString
  } catch {}
  try {
    const p2 = path.join(__dirname, '..', 'db', 'db_config.json')
    if (fs.existsSync(p2)) return JSON.parse(fs.readFileSync(p2,'utf8')).connectionString
  } catch {}
  try {
    const env = process.env.COREPMS_DB_URL || process.env.DATABASE_URL
    if (env) return env
  } catch {}
  return null
}

async function run() {
  const conn = findConfig()
  if (!conn) { console.error('No DB connection found'); process.exit(1) }
  const pool = new Pool({ connectionString: conn })
  const client = await pool.connect()
  try {
    console.log('[corepms] Starting mock data cleanup')
    await client.query('BEGIN')
    await client.query("UPDATE public.app_users SET password = '$2a$10$6p7khibx7uU2TnEa1M0QpOnE6O41YQZKpYo6jPhPGZZiYUvqQbJ2e' WHERE username = 'admin'")
    await client.query("DELETE FROM public.app_users WHERE is_mock_account = TRUE AND username <> 'admin'")
    await client.query("DELETE FROM public.guests WHERE (email LIKE 'test@%' OR phone LIKE '000%')")
    await client.query("DELETE FROM public.reservations WHERE guest_id NOT IN (SELECT id FROM public.guests)")
    await client.query('COMMIT')
    console.log('[corepms] Cleanup complete. Admin preserved (admin/admin123).')
  } catch (e) {
    console.error('[corepms] Cleanup failed:', e && e.message ? e.message : e)
    try { await client.query('ROLLBACK') } catch {}
    process.exit(2)
  } finally {
    client.release(); pool.end()
  }
}

run()

