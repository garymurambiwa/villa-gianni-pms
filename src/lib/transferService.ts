import { db } from './db';

export interface TransferResult {
    ok: boolean;
    error?: string;
    oldRoomNumber?: string;
    newRoomNumber?: string;
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
            let oldRoomNumber: string | null = null;

            // 1. Fetch Reservation by ID
            if (reservationId) {
                const resQuery = await db.query<any>(
                    `SELECT r.id, r.room_id, r.guest_id, r.folio_id, ro.number as room_number
                     FROM reservations r
                     LEFT JOIN rooms ro ON ro.id = r.room_id
                     WHERE r.id = $1`,
                    [reservationId]
                );
                if ('rows' in resQuery && resQuery.rows && resQuery.rows.length) {
                    reservation = resQuery.rows[0];
                    oldRoomId = resQuery.rows[0].room_id;
                    oldRoomNumber = resQuery.rows[0].room_number;
                }
            }

            // 2. If not found by reservation ID, search by room_id (quick check-in guests)
            if (!reservation && reservationId) {
                const roomResQuery = await db.query<any>(
                    `SELECT r.id, r.room_id, r.guest_id, r.folio_id, ro.number as room_number
                     FROM reservations r
                     LEFT JOIN rooms ro ON ro.id = r.room_id
                     WHERE r.room_id = $1 AND r.status IN ('checked-in', 'checkedin', 'confirmed')
                     LIMIT 1`,
                    [reservationId]
                );
                if ('rows' in roomResQuery && roomResQuery.rows && roomResQuery.rows.length) {
                    reservation = roomResQuery.rows[0];
                    oldRoomId = roomResQuery.rows[0].room_id;
                    oldRoomNumber = roomResQuery.rows[0].room_number;
                }
            }

            if (!targetRoomId) return { ok: false, error: 'Target room ID is required' };
            if (oldRoomId && oldRoomId === targetRoomId) return { ok: false, error: 'Cannot transfer to the same room' };

            // 3. Fetch Target Room details
            const roomQuery = await db.query<any>(
                `SELECT id, number, status, type FROM rooms WHERE id = $1`,
                [targetRoomId]
            );
            if (!('rows' in roomQuery) || !roomQuery.rows || !roomQuery.rows.length) {
                return { ok: false, error: 'Target room not found' };
            }
            const targetRoom = roomQuery.rows[0];

            // Validate target room is available
            if (!['VC', 'VD', 'vacant', 'available'].includes(String(targetRoom.status || '').toUpperCase()) &&
                !['VC', 'VD'].includes(String(targetRoom.status || ''))) {
                return { ok: false, error: `Room ${targetRoom.number} is not available (status: ${targetRoom.status})` };
            }

            // 4. Build atomic transaction
            const operations: { sql: string; params: any[] }[] = [];

            // A. Update Reservation - assign new room_id AND update room_type
            if (reservation) {
                operations.push({
                    sql: `UPDATE reservations
                          SET room_id = $1, room_type = $2, updated_at = NOW()
                          WHERE id = $3`,
                    params: [targetRoomId, targetRoom.type, reservation.id]
                });
            }

            // B. Update Folio - new room_number
            if (reservation) {
                operations.push({
                    sql: `UPDATE folios SET room_number = $1, updated_at = NOW()
                          WHERE reservation_id = $2 OR guest_id = $3`,
                    params: [targetRoom.number, reservation.id, (reservation as any).guest_id]
                });
            }

            // C. Update active Folio Charges - new room_number
            if (reservation) {
                operations.push({
                    sql: `UPDATE folio_charges
                          SET room_number = $1, updated_at = NOW()
                          WHERE reservation_id = $2 AND is_voided = false`,
                    params: [targetRoom.number, reservation.id]
                });
            }

            // D. Update Folio Payments - new room_number
            if (reservation) {
                operations.push({
                    sql: `UPDATE folio_payments
                          SET room_number = $1, updated_at = NOW()
                          WHERE reservation_id = $2`,
                    params: [targetRoom.number, reservation.id]
                });
            }

            // E. Release old room → VD (Vacant Dirty) or OOO
            const oldStatus = markOldAsOOO ? 'OOO' : 'VD';
            if (oldRoomId) {
                operations.push({
                    sql: `UPDATE rooms SET status = $1, updated_at = NOW() WHERE id = $2`,
                    params: [oldStatus, oldRoomId]
                });
            }

            // F. Mark new room as Occupied Clean
            operations.push({
                sql: `UPDATE rooms SET status = 'OC', updated_at = NOW() WHERE id = $1`,
                params: [targetRoomId]
            });

            // G. Log transfer in system_audits
            operations.push({
                sql: `INSERT INTO system_audits (id, action, entity_type, entity_id, user_id, details, timestamp)
                      VALUES (gen_random_uuid()::text, 'ROOM_TRANSFER', 'RESERVATION', $1, 'SYSTEM', $2::jsonb, NOW())
                      ON CONFLICT DO NOTHING`,
                params: [
                    reservation?.id || targetRoomId,
                    JSON.stringify({
                        from_room: oldRoomNumber,
                        to_room: targetRoom.number,
                        reason,
                        actor: actorName,
                        mark_old_as_ooo: markOldAsOOO
                    })
                ]
            });

            const result = await db.transaction(operations);

            if (!result.ok) {
                return { ok: false, error: (result as any).error || 'Transaction failed' };
            }

            return {
                ok: true,
                oldRoomNumber: oldRoomNumber || undefined,
                newRoomNumber: targetRoom.number
            };

        } catch (e: any) {
            console.error('[TransferService] Error:', e);
            return { ok: false, error: e.message || 'Transfer failed' };
        }
    }
};
