import { db } from '../src/lib/db';

async function dropConstraint() {
  try {
    // Try to drop the constraint with the exact name from the error
    await db.query(`ALTER TABLE public.inv_items DROP CONSTRAINT IF EXISTS inv_items_short_len;`);
    console.log('Dropped constraint inv_items_short_len if it existed.');
  } catch (err) {
    console.error('Error dropping constraint inv_items_short_len:', err);
  }

  try {
    // Try to drop the constraint with the name we found in the migration
    await db.query(`ALTER TABLE public.inv_items DROP CONSTRAINT IF EXISTS inv_items_short_id_len;`);
    console.log('Dropped constraint inv_items_short_id_len if it existed.');
  } catch (err) {
    console.error('Error dropping constraint inv_items_short_id_len:', err);
  }

  process.exit(0);
}

dropConstraint();