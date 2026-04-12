import { db } from './db';
import { Room } from '@/types';

export interface TransferResult {
    ok: boolean;
    error?: string;
}

/**
 * Service to handle transferring a guest (reservation + folio) to a new room.
 */
export const transferService = {
    /**
     * Transfer a reservation to a new room.
     * Updates:
     * 1. Reservation record (room_id, room_number)
     * 2. Folio record (room_number)
     * 3. Folio charges (room_number)
     * 4. Old Room status -> 'VD' (Vacant Dirty) or 'OOO'
     * 5. New Room status -> 'OC' (Occupied Clean)
     * 
     * Note: If no reservation exists (quick check-in case), still performs:
     * - Room status updates (old room -> VD/OOO, new room -> OC)
     */
    async transferGuest(
        reservationId: string | null,
        targetRoomId: string,
        reason: string,
        markOldAsOOO: boolean = false,
        actorName: string = 'System'
    ): Promise<TransferResult> {
        try {
            let reservation: { id: string; room_id: string; guest_id: string; folio_id: string } | null = null;
            let oldRoomId: string | null = null;

            // 1. Fetch Reservation (if ID provided)
            if (reservationId) {
                const resQuery = await db.query<{ id: string; room_id: string; guest_id: string; folio_id: string }>(
                    `SELECT id, room_id, guest_id, folio_id FROM reservations WHERE id = ?`,
                    [reservationId]
                );
                if (resQuery && resQuery.rows && resQuery.rows.length) {
                    reservation = resQuery.rows[0];
                    oldRoomId = reservation.room_id;
                }
            }

            // 2. If no reservation found, try to find by current room ID (for quick check-in guests)
            if (!reservation && reservationId) {
                // Reservation ID was given but not found - try looking up by room
                const roomResQuery = await db.query<{ id: string; room_id: string; guest_id: string; folio_id: string }>(
                    `SELECT id, room_id, guest_id, folio_id FROM reservations WHERE room_id = ? AND status IN ('checkedin', 'confirmed')`,
                    [reservationId]
                );
                if (roomResQuery && roomResQuery.rows && roomResQuery.rows.length) {
                    reservation = roomResQuery.rows[0];
                    oldRoomId = reservation.room_id;
                }
            }

            if (!targetRoomId) return { ok: false, error: 'Target room ID is required' };
            if (oldRoomId === targetRoomId) return { ok: false, error: 'Cannot transfer to the same room' };

            // 3. Fetch Target Room details
            const roomQuery = await db.query<{ id: string; number: string; status: string }>(
                `SELECT id, number, status FROM rooms WHERE id = ?`,
                [targetRoomId]
            );
            if (!roomQuery || !roomQuery.rows || !roomQuery.rows.length) return { ok: false, error: 'Target room not found' };
            const targetRoom = roomQuery.rows[0];

            // 4. Begin Transaction
            const operations: (string | { sql: string; params: any[] })[] = [];

            // A. Update Reservation (if exists)
            if (reservation) {
                operations.push({
                    sql: `UPDATE reservations SET room_id = ?, updated_at = NOW() WHERE id = ?`,
                    params: [targetRoomId, reservation.id]
                });
            }

            // B. Update Folio (if reservation exists)
            if (reservation) {
                operations.push({
                    sql: `UPDATE folios SET room_number = ?, updated_at = NOW() WHERE reservation_id = ?`,
                    params: [targetRoom.number, reservation.id]
                });
            }

            // C. Update Folio Charges (Move active charges to new room number for clarity)
            if (reservation) {
                operations.push({
                    sql: `UPDATE folio_charges SET room_number = ?, updated_at = NOW() WHERE reservation_id = ?`,
                    params: [targetRoom.number, reservation.id]
                });
            }

            // D. Update Folio Payments
            if (reservation) {
                operations.push({
                    sql: `UPDATE folio_payments SET room_number = ?, updated_at = NOW() WHERE reservation_id = ?`,
                    params: [targetRoom.number, reservation.id]
                });
            }

            // E. Update Old Room Status
            // If markOldAsOOO is true, set to OOO, else VD (Vacant Dirty)
            const oldStatus = markOldAsOOO ? 'OOO' : 'VD';
            if (oldRoomId) {
                operations.push({
                    sql: `UPDATE rooms SET status = ? WHERE id = ?`,
                    params: [oldStatus, oldRoomId]
                });
            }

            // F. Update New Room Status -> OC (Occupied Clean) 
            operations.push({
                sql: `UPDATE rooms SET status = 'OC' WHERE id = ?`,
                params: [targetRoomId]
            });

            const result = await db.transaction(operations);

            if (!result.ok) {
                return { ok: false, error: result.error || 'Transaction failed' };
            }

            return { ok: true };

        } catch (e: any) {
            return { ok: false, error: e.message || 'Transfer failed' };
        }
    }
};
