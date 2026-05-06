import { db } from './db';

export interface TransferResult {
    ok: boolean;
    error?: string;
    oldRoomNumber?: string;
    newRoomNumber?: string;
}

/**
 * Service to handle transferring a guest (reservation + folio) to a new room.
 *
 * NOTE: reservations table has NO updated_at column — do NOT include it in UPDATE.
 */
export const transferService = {
    async transferGuest(
        reservationId: string | null,
        targetRoomId: string,
        reason: string,
        markOldAsOOO: boolean = false,
        actorName: string = 'System'
    ): Promise<TransferResult> {
        try {
            if (!targetRoomId) return { ok: false, error: 'Target room ID is required' };

            // ── 1. Resolve reservation ─────────────────────────────────────────
            let reservation: any = null;
            let oldRoomId: string | null = null;
            let oldRoomNumber: string | null = null;

            if (reservationId) {
                // Primary: look up by reservation ID
                const resQuery = await db.query<any>(
                    `SELECT r.id, r.room_id, r.guest_id, ro.number AS room_number
                     FROM reservations r
                     LEFT JOIN rooms ro ON ro.id = r.room_id
                     WHERE r.id = $1`,
                    [reservationId]
                );
                if ('rows' in resQuery && resQuery.rows?.length) {
                    reservation   = resQuery.rows[0];
                    oldRoomId     = reservation.room_id;
                    oldRoomNumber = reservation.room_number;
                }

                // Fallback: treat reservationId as a room_id (for guests without a direct res link)
                if (!reservation) {
                    const roomResQuery = await db.query<any>(
                        `SELECT r.id, r.room_id, r.guest_id, ro.number AS room_number
                         FROM reservations r
                         LEFT JOIN rooms ro ON ro.id = r.room_id
                         WHERE r.room_id = $1
                           AND r.status IN ('checked-in','confirmed','pending')
                         ORDER BY r.inserted_at DESC
                         LIMIT 1`,
                        [reservationId]
                    );
                    if ('rows' in roomResQuery && roomResQuery.rows?.length) {
                        reservation   = roomResQuery.rows[0];
                        oldRoomId     = reservation.room_id;
                        oldRoomNumber = reservation.room_number;
                    }
                }
            }

            if (oldRoomId === targetRoomId) {
                return { ok: false, error: 'Cannot transfer to the same room' };
            }

            // ── 2. Validate target room ────────────────────────────────────────
            const roomQuery = await db.query<any>(
                `SELECT id, number, status, type FROM rooms WHERE id = $1`,
                [targetRoomId]
            );
            if (!('rows' in roomQuery) || !roomQuery.rows?.length) {
                return { ok: false, error: 'Target room not found' };
            }
            const targetRoom = roomQuery.rows[0];

            // ── 3. Build atomic transaction ────────────────────────────────────
            const ops: { sql: string; params: any[] }[] = [];

            // A. Reservation — update room assignment
            //    IMPORTANT: reservations table has no updated_at column
            if (reservation) {
                ops.push({
                    sql: `UPDATE reservations
                          SET room_id = $1, room_type = $2
                          WHERE id = $3`,
                    params: [targetRoomId, targetRoom.type, reservation.id]
                });
            }

            // B. Folio — update room_number
            if (reservation) {
                ops.push({
                    sql: `UPDATE folios
                          SET room_number = $1, updated_at = NOW()
                          WHERE reservation_id = $2 OR guest_id = $3`,
                    params: [targetRoom.number, reservation.id, reservation.guest_id]
                });
            }

            // C. Folio charges — move active charges to new room
            if (reservation) {
                ops.push({
                    sql: `UPDATE folio_charges
                          SET room_number = $1, updated_at = NOW()
                          WHERE reservation_id = $2 AND is_voided = false`,
                    params: [targetRoom.number, reservation.id]
                });
            }

            // D. Folio payments
            if (reservation) {
                ops.push({
                    sql: `UPDATE folio_payments
                          SET room_number = $1, updated_at = NOW()
                          WHERE reservation_id = $2`,
                    params: [targetRoom.number, reservation.id]
                });
            }

            // E. Release old room → VD (Vacant Dirty) or OOO
            if (oldRoomId) {
                ops.push({
                    sql: `UPDATE rooms SET status = $1, updated_at = NOW() WHERE id = $2`,
                    params: [markOldAsOOO ? 'OOO' : 'VD', oldRoomId]
                });
            }

            // F. Mark new room as Occupied Clean
            ops.push({
                sql: `UPDATE rooms SET status = 'OC', updated_at = NOW() WHERE id = $1`,
                params: [targetRoomId]
            });

            // G. Audit log
            ops.push({
                sql: `INSERT INTO system_audits (id, action, entity_type, entity_id, user_id, details)
                      VALUES (gen_random_uuid()::text, 'ROOM_TRANSFER', 'RESERVATION', $1, 'SYSTEM', $2::jsonb)
                      ON CONFLICT DO NOTHING`,
                params: [
                    reservation?.id || targetRoomId,
                    JSON.stringify({
                        from_room: oldRoomNumber,
                        to_room: targetRoom.number,
                        reason,
                        actor: actorName,
                        mark_old_as_ooo: markOldAsOOO,
                        ts: new Date().toISOString()
                    })
                ]
            });

            const result = await db.transaction(ops);
            if (!(result as any).ok) {
                console.error('[TransferService] Transaction failed:', (result as any).error);
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
