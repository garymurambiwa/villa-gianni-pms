import { db } from '@/lib/db';

export interface Vendor { id: string; name: string; currency?: string; terms?: string }

// Migrated to DB-backed service
export const listVendors = async (): Promise<Vendor[]> => {
  try {
    const res = await db.query('SELECT * FROM vendors ORDER BY name');
    if ('rows' in res) {
      return res.rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        currency: r.currency,
        terms: r.terms
      }));
    }
    return [];
  } catch (e) {
    console.error('Failed to list vendors:', e);
    return [];
  }
};

export const addVendor = async (name: string, currency?: string, terms?: string): Promise<Vendor | null> => {
  const id = `V${Date.now()}`;
  try {
    await db.query(
      'INSERT INTO vendors (id, name, currency, terms, created_at) VALUES (?, ?, ?, ?, NOW())',
      [id, name, currency || 'USD', terms || null]
    );
    return { id, name, currency, terms };
  } catch (e) {
    console.error('Failed to add vendor:', e);
    return null;
  }
};

export default { listVendors, addVendor };
