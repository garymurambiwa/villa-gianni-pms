-- ============================================================================
-- BARADZANWA ROOMS RESTORATION SCRIPT
-- Generated: 2026-05-04
-- Evidence source: Reservation history analysis showing:
--   - 24 distinct room_type/rate combinations in bookings
--   - "Deluxe Queen" type completely absent from rooms table (20+ bookings)
--   - Standard Room rate at Baradzanwa is $90 (not $80 as in Villa Gianni seed)
--   - Total should be 31 rooms
--
-- WHAT THIS SCRIPT DOES:
--   1. Corrects the 13 existing rooms to Baradzanwa rates/types
--   2. Adds 18 missing rooms to restore the full 31-room configuration
--   3. Restores the Deluxe Queen room type completely
--
-- Run with: psql $DATABASE_URL -f baradzanwa_rooms_restore.sql
-- OR via: GET /api/setup/restore-baradzanwa-rooms?key=confirm
-- ============================================================================

-- STEP 1: Fix existing rooms - correct rates overwritten by Villa Gianni schema seed
-- Based on actual booking rates from reservation history

UPDATE rooms SET type='Standard Room', rate=90.00, updated_at=NOW() WHERE number='103' AND rate=80.00;
UPDATE rooms SET type='Standard Room', rate=90.00, updated_at=NOW() WHERE number='105' AND rate=80.00;
UPDATE rooms SET type='Deluxe Queen',  rate=100.00, updated_at=NOW() WHERE number='106';
UPDATE rooms SET type='Executive Room', rate=90.00, updated_at=NOW() WHERE number='107';
UPDATE rooms SET type='Executive Room', rate=90.00, updated_at=NOW() WHERE number='108';
UPDATE rooms SET type='Executive Room', rate=100.00, updated_at=NOW() WHERE number='109';
UPDATE rooms SET type='Executive Room', rate=100.00, updated_at=NOW() WHERE number='110';
UPDATE rooms SET type='Deluxe Queen',   rate=100.00, updated_at=NOW() WHERE number='112';
UPDATE rooms SET type='Standard Room',  name='Standard Roon', updated_at=NOW() WHERE number='101' AND type='Standard Roon'; -- Fix typo

-- Fix typo: "Standard Roon" → "Standard Room"
UPDATE rooms SET type='Standard Room', updated_at=NOW() WHERE type='Standard Roon';

-- STEP 2: Insert missing rooms to restore full 31-room configuration
-- Room 113 was in schema (skipped) - add Deluxe Queen
INSERT INTO rooms (id, number, type, status, rate, floor, is_active, inserted_at, updated_at) VALUES
  -- Deluxe Queen rooms (primary Baradzanwa room type, evidence: 20+ bookings)
  (gen_random_uuid()::text, '113', 'Deluxe Queen',  'vacant', 90.00,  1, true, NOW(), NOW()),
  (gen_random_uuid()::text, '115', 'Deluxe Queen',  'vacant', 90.00,  1, true, NOW(), NOW()),
  (gen_random_uuid()::text, '116', 'Deluxe Queen',  'vacant', 90.00,  1, true, NOW(), NOW()),
  (gen_random_uuid()::text, '117', 'Deluxe Queen',  'vacant', 90.00,  1, true, NOW(), NOW()),
  (gen_random_uuid()::text, '118', 'Deluxe Queen',  'vacant', 100.00, 1, true, NOW(), NOW()),
  (gen_random_uuid()::text, '119', 'Deluxe Queen',  'vacant', 100.00, 1, true, NOW(), NOW()),
  (gen_random_uuid()::text, '120', 'Deluxe Queen',  'vacant', 100.00, 1, true, NOW(), NOW()),
  -- Standard Rooms (evidence: many bookings at $90)
  (gen_random_uuid()::text, '121', 'Standard Room', 'vacant', 90.00,  1, true, NOW(), NOW()),
  (gen_random_uuid()::text, '122', 'Standard Room', 'vacant', 90.00,  1, true, NOW(), NOW()),
  (gen_random_uuid()::text, '123', 'Standard Room', 'vacant', 90.00,  1, true, NOW(), NOW()),
  (gen_random_uuid()::text, '124', 'Standard Room', 'vacant', 90.00,  1, true, NOW(), NOW()),
  -- Executive Rooms (evidence: bookings at $100-$110)
  (gen_random_uuid()::text, '125', 'Executive Room', 'vacant', 100.00, 1, true, NOW(), NOW()),
  (gen_random_uuid()::text, '126', 'Executive Room', 'vacant', 100.00, 1, true, NOW(), NOW()),
  (gen_random_uuid()::text, '127', 'Executive Room', 'vacant', 100.00, 1, true, NOW(), NOW()),
  (gen_random_uuid()::text, '128', 'Executive Room', 'vacant', 110.00, 1, true, NOW(), NOW()),
  -- Executive Suites (evidence: bookings at $90)
  (gen_random_uuid()::text, '129', 'Executive Suite', 'vacant', 90.00, 1, true, NOW(), NOW()),
  (gen_random_uuid()::text, '130', 'Executive Suite', 'vacant', 90.00, 1, true, NOW(), NOW()),
  -- Family/Standard Room
  (gen_random_uuid()::text, '131', 'Standard Room',  'vacant', 90.00, 1, true, NOW(), NOW())
ON CONFLICT (number) DO NOTHING;

-- STEP 3: Verify final count
SELECT COUNT(*) as total_rooms,
       COUNT(CASE WHEN type='Standard Room' THEN 1 END) as standard,
       COUNT(CASE WHEN type='Deluxe Queen' THEN 1 END) as deluxe_queen,
       COUNT(CASE WHEN type='Executive Room' THEN 1 END) as executive_room,
       COUNT(CASE WHEN type='Executive Suite' THEN 1 END) as executive_suite,
       COUNT(CASE WHEN type='Villa Self Catering' THEN 1 END) as villa
FROM rooms
WHERE is_active IS DISTINCT FROM false;
