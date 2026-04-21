import { Pool } from 'pg';

const pool = new Pool({ 
  connectionString: 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require' 
});

console.log('=== VERIFYING FIXES ===');

// 1. Check that no POS shifts are open
pool.query("SELECT COUNT(*) as open_count FROM pos_shifts WHERE status = 'open'", (err, res) => {
  if (err) {
    console.error('Error checking open shifts:', err.message);
  } else {
    console.log(`Open POS shifts: ${res.rows[0].open_count}`);
  }
});

// 2. Check recent folio charges 
pool.query("SELECT COUNT(*) as count FROM folio_charges WHERE posting_date = CURRENT_DATE", (err2, res2) => {
  if (err2) {
    console.error('Error checking today\'s folio charges:', err2.message);
  } else {
    console.log(`Today\'s folio charges: ${res2.rows[0].count}`);
  }
});

// 3. Check recent POS orders
pool.query("SELECT COUNT(*) as count FROM pos_orders WHERE created_at >= CURRENT_DATE", (err3, res3) => {
  if (err3) {
    console.error('Error checking today\'s POS orders:', err3.message);
  } else {
    console.log(`Today\'s POS orders: ${res3.rows[0].count}`);
  }
});

// 4. Check night audit runs from last 2 days
pool.query("SELECT COUNT(*) as count FROM night_audit_runs WHERE inserted_at >= CURRENT_DATE - INTERVAL '2 days'", (err4, res4) => {
  if (err4) {
    console.error('Error checking recent night audit runs:', err4.message);
  } else {
    console.log(`Recent night audit runs (2 days): ${res4.rows[0].count}`);
  }
  
  // 5. Check reconciliation logs from last 2 days
  pool.query("SELECT COUNT(*) as count FROM reconciliation_logs WHERE inserted_at >= CURRENT_DATE - INTERVAL '2 days'", (err5, res5) => {
    if (err5) {
      console.error('Error checking recent reconciliation logs:', err5.message);
    } else {
      console.log(`Recent reconciliation logs (2 days): ${res5.rows[0].count}`);
    }
    pool.end();
  });
});