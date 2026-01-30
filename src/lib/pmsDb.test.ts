import { describe, it, expect, vi, beforeEach } from 'vitest';
import pmsDb from '@/lib/pmsDb';
import db from '@/lib/db';

// Mock the db module
vi.mock('@/lib/db', () => ({
  default: {
    query: vi.fn(),
  },
}));

// Mock ratePlanService if needed (it's used in DataContext, not pmsDb directly, but good to know)
// pmsDb uses ensureGuest which queries 'guests' table.

describe('pmsDb', () => {
  let pmsDb: typeof import('@/lib/pmsDb').default;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    // Re-import pmsDb to reset module-level cache (statusColCache)
    pmsDb = (await import('@/lib/pmsDb')).default;
  });

  describe('createReservation', () => {
    it('should create a reservation successfully', async () => {
      // Mock resolveStatusColumn
      (db.query as any).mockResolvedValueOnce({ rows: [{ column_name: 'status' }] });
      
      // Mock ensureGuest (select guest -> not found -> insert guest)
      (db.query as any).mockResolvedValueOnce({ rows: [] }); // Select guest empty
      (db.query as any).mockResolvedValueOnce({ rows: [{ id: 'guest-123' }] }); // Insert guest success
      
      // Mock insert reservation
      (db.query as any).mockResolvedValueOnce({ rows: [{ id: 'res-123' }] });
      
      // Mock select newly created reservation
      const mockRes = {
        id: 'res-123',
        guest_id: 'guest-123',
        full_name: 'John Doe',
        check_in_date: '2023-01-01',
        check_out_date: '2023-01-05',
        status: 'confirmed',
        source: 'website',
        id_document_enc: 'enc-123',
        package_code: 'RO',
        // ... other fields optional
      };
      (db.query as any).mockResolvedValueOnce({ rows: [mockRes] });

      const input = {
        guestName: 'John Doe',
        roomType: 'Standard',
        checkIn: '2023-01-01',
        checkOut: '2023-01-05',
        rate: 100,
        adults: 2,
        children: 0,
        idDocumentNumberEncrypted: 'enc-123',
        originRegion: 'website',
        status: 'confirmed' as const,
        packageCode: 'RO',
      };

      const result = await pmsDb.createReservation(input);

      expect(result).toBeDefined();
      expect(result.id).toBe('res-123');
      expect(result.guestName).toBe('John Doe');
      expect(result.status).toBe('confirmed');
      expect(db.query).toHaveBeenCalledTimes(5); // column check, guest check, guest insert, res insert, res select
    });

    it('should handle db errors gracefully', async () => {
      // Mock resolveStatusColumn
      (db.query as any).mockResolvedValueOnce({ rows: [{ column_name: 'status' }] });
      // Mock guest check failure
      (db.query as any).mockResolvedValueOnce({ error: 'DB Connection Failed' });

      const input = {
        guestName: 'Jane Doe',
        roomType: 'Standard',
        checkIn: '2023-01-01',
        checkOut: '2023-01-02',
        rate: 100,
        adults: 1,
        children: 0,
        idDocumentNumberEncrypted: 'enc-456',
        originRegion: 'website',
      };

      await expect(pmsDb.createReservation(input)).rejects.toThrow('DB Connection Failed');
    });
  });

  describe('listReservations', () => {
    it('should return a list of reservations', async () => {
      // Mock resolveStatusColumn
      (db.query as any).mockResolvedValueOnce({ rows: [{ column_name: 'status' }] });
      
      const mockRows = [
        {
          id: 'res-1',
          full_name: 'Guest 1',
          check_in_date: '2023-01-01',
          check_out_date: '2023-01-05',
          status: 'booked',
          id_document_enc: 'enc-1',
          package_code: 'RO'
        },
        {
          id: 'res-2',
          full_name: 'Guest 2',
          check_in_date: '2023-02-01',
          check_out_date: '2023-02-05',
          status: 'checked_in',
          id_document_enc: 'enc-2',
          package_code: 'BB'
        }
      ];
      (db.query as any).mockResolvedValueOnce({ rows: mockRows });

      const list = await pmsDb.listReservations();
      expect(list).toHaveLength(2);
      expect(list[0].guestName).toBe('Guest 1');
      expect(list[1].status).toBe('checked-in');
    });
  });
});
