/**
 * Conference-room support.
 *
 * Conference rooms live in the SAME rooms table / reservation system as guest
 * rooms (type = 'Conference'), but are excluded from every rooms KPI —
 * occupancy %, ADR/ARR, RevPAR, rooms-available and rooms-sold — so adding
 * conference space never distorts accommodation statistics. Their revenue
 * posts to Conference & Events (GL 4200), never to Rooms Revenue (4000).
 */

export const CONFERENCE_TYPE = 'Conference';

/** True when a room record is a conference room (type contains "conference"). */
export const isConferenceRoom = (room: any): boolean =>
  /conference/i.test(String(room?.type || ''));

/** Filter helper: only guest rooms (KPI denominator/numerator source). */
export const guestRoomsOnly = <T = any>(rooms: T[]): T[] =>
  (rooms || []).filter(r => !isConferenceRoom(r));
