import { db } from '../src/lib/db';

async function checkConstraints() {
  const res = await db.query(`
    SELECT conname, contype, consrc
    FROM pg_constraint
    WHERE conrelid = 'public.inv_items'::regclass
    AND contype = 'c';
  `);
  console.log('Check constraints on inv_items:');
  console.log(res.rows);
}

checkConstraints().catch(console.error);