import { Pool } from 'pg';

const pool = new Pool({ 
  connectionString: 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require' 
});

// Close all open POS shifts by setting closing_cash, status, closed_at, closed_by
pool.query("UPDATE pos_shifts SET status = 'closed', closing_cash = opening_cash, closed_at = NOW(), closed_by = 'system_fix' WHERE status = 'open'", (err, res) => {
  if (err) {
    console.error('Error closing active POS shifts:', err.message);
    pool.end();
    return;
  }
  
  console.log(`Closed ${res.rowCount} active POS shifts`);
  
  // Verify the changes
  pool.query("SELECT COUNT(*) as open_count FROM pos_shifts WHERE status = 'open'", (err2, res2) => {
    if (err2) {
      console.error('Error checking open shifts:', err2.message);
    } else {
      console.log(`Remaining open POS shifts: ${res2.rows[0].open_count}`);
    }
    pool.end();
  });
});