// drop_constraint.js
// Uses the backend API to drop the constraint on inv_items

const API_URL = 'http://localhost:3000/api'; // Adjust if necessary

async function dropConstraint() {
  try {
    // First, let's see what check constraints exist on inv_items
    const res = await fetch(`${API_URL}/db/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: `
          SELECT conname, contype, consrc
          FROM pg_constraint
          WHERE conrelid = 'public.inv_items'::regclass
          AND contype = 'c';
        `,
        params: []
      })
    });
    const data = await res.json();
    if (data.error) {
      throw new Error(data.error);
    }
    console.log('Check constraints on inv_items:');
    console.log(data.rows);

    // Now, try to drop the constraint by the name from the error
    const constraintName = 'inv_items_short_len';
    try {
      const dropRes = await fetch(`${API_URL}/db/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql: `ALTER TABLE public.inv_items DROP CONSTRAINT IF EXISTS ${constraintName};`
        })
      });
      const dropData = await dropRes.json();
      if (dropData.error) {
        throw new Error(dropData.error);
      }
      console.log(`Dropped constraint ${constraintName} if it existed.`);
    } catch (err) {
      console.error(`Error dropping constraint ${constraintName}:`, err);
    }

    // Also try the alternative we saw in the migration
    const constraintName2 = 'inv_items_short_id_len';
    try {
      const dropRes2 = await fetch(`${API_URL}/db/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql: `ALTER TABLE public.inv_items DROP CONSTRAINT IF EXISTS ${constraintName2};`
        })
      });
      const dropData2 = await dropRes2.json();
      if (dropData2.error) {
        throw new Error(dropData2.error);
      }
      console.log(`Dropped constraint ${constraintName2} if it existed.`);
    } catch (err) {
      console.error(`Error dropping constraint ${constraintName2}:`, err);
    }

  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

dropConstraint();