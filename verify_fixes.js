// Verification script to check if fixes have been applied correctly
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
    console.log(`Open POS shifts: ${res.rows[0].open_count} ${res.rows[0].open_count === 0 ? '✓ FIXED' : '✗ STILL OPEN'}`);
  }
  
  // 2. Check recent folio charges (should exist from night audit)
  pool.query("SELECT COUNT(*) as count FROM folio_charges WHERE posting_date = CURRENT_DATE", (err2, res2) => {
    if (err2) {
      console.error('Error checking today\'s folio charges:', err2.message);
    } else {
      console.log(`Today\'s folio charges: ${res2.rows[0].count} ${res2.rows[0].count > 0 ? '✓ DATA PRESENT' : '✗ NO TODAY\'S DATA'}`);
    }
    
    // 3. Check recent POS orders
    pool.query("SELECT COUNT(*) as count FROM pos_orders WHERE created_at >= CURRENT_DATE", (err3, res3) => {
      if (err3) {
        console.error('Error checking today\'s POS orders:', err3.message);
      } else {
        console.log(`Today\'s POS orders: ${res3.rows[0].count} ${res3.rows[0].count > 0 ? '✓ DATA PRESENT' : '✗ NO TODAY\'S ORDERS'}`);
      }
      
      // 4. Check night audit runs
      pool.query("SELECT COUNT(*) as count FROM night_audit_runs WHERE inserted_at >= CURRENT_DATE - INTERVAL '1 day'", (err4, res4) => {
        if (err4) {
          console.error('Error checking recent night audit runs:', err4.message);
        } else {
          console.log(`Recent night audit runs: ${res4.rows[0].count} ${res4.rows[0].count > 0 ? '✓ NIGHT AUDIT RUNNING' : '✗ NO RECENT NIGHT AUDIT'}`);
          
          // 5. Check reconciliation logs
          pool.query("SELECT COUNT(*) as count FROM reconciliation_logs WHERE inserted_at >= CURRENT_DATE - INTERVAL '1 day'", (err5, res5) => {
            if (err5) {
              console.error('Error checking recent reconciliation logs:', err5.message);
            } else {
              console.log(`Recent reconciliation logs: ${res5.rows[0].count} ${res5.rows[0].count > 0 ? '✓ RECONCILIATION ACTIVE' : '✗ NO RECENT RECONCILIATION'}`);
              
              console.log('\n=== SUMMARY ===');
              const fixesApplied = [
                res.rows[0].open_count === 0, // No open shifts
                res2.rows[0].count > 0, // Folio charges present
                res3.rows[0].count > 0, // POS orders present
                res4.rows[0].count > 0, // Night audit running
                res5.rows[0].count > 0  // Reconciliation active
              ];
              
              const allFixed = fixesApplied.every(Boolean);
              console.log(`Fixes applied: ${fixesApplied.filter(Boolean).length}/${fixesApplied.length}`);
              console.log(`Overall status: ${allFixed ? '✓ ALL FIXES APPLIED - REPORTING SHOULD WORK' : '✗ SOME ISSUES REMAIN'}`);
              
              if (!allFixed) {
                console.log('\nRemaining issues:');
                if (!(res.rows[0].open_count === 0)) console.log('- POS shifts still open');
                if (!(res2.rows[0].count > 0)) console.log('- No folio charges for today');
                if (!(res3.rows[0].count > 0)) console.log('- No POS orders for today');
                if (!(res4.rows[0].count > 0)) console.log('- No recent night audit runs');
                if (!(res5.rows[0].count > 0)) console.log('- No recent reconciliation logs');
              }
            }
            pool.end();
          });
        }
      });
    }
  });
});