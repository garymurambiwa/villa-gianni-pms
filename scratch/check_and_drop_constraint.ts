import { db } from '../src/lib/db';

async function main() {
  try {
    // First, let's see what check constraints exist on inv_items
    const res = await db.query(`
      SELECT conname, contype, consrc
      FROM pg_constraint
      WHERE conrelid = 'public.inv_items'::regclass
      AND contype = 'c';
    `);

    if (res.error) {
      throw new Error(res.error);
    }

    console.log('Check constraints on inv_items:');
    console.log(res.rows);

    // Now, try to drop the constraint by the name from the error
    const constraintName = 'inv_items_short_len';
    try {
      await db.query(`ALTER TABLE public.inv_items DROP CONSTRAINT IF EXISTS ${constraintName};`);
      console.log(`Dropped constraint ${constraintName} if it existed.`);
    } catch (err) {
      console.error(`Error dropping constraint ${constraintName}:`, err);
    }

    // Also try the alternative we saw in the migration
    const constraintName2 = 'inv_items_short_id_len';
    try {
      await db.query(`ALTER TABLE public.inv_items DROP CONSTRAINT IF EXISTS ${constraintName2};`);
      console.log(`Dropped constraint ${constraintName2} if it existed.`);
    } catch (err) {
      console.error(`Error dropping constraint ${constraintName2}:`, err);
    }

  } catch (err) {
    console.error('Unexpected error:', err);
  } finally {
    process.exit(0);
  }
}

main();