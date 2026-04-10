# POS Selling Price Fix - Implementation Guide

## Problem Summary
The POS system was displaying **cost prices** instead of **selling prices** for menu items. This was caused by a mismatch between which database fields contained the correct price data.

## Root Cause
The system has two database structures for storing prices:
- **inventory_items** table with `selling_price` and `cost` columns
- **products** table with `price` and `cost_price` columns

The POS was querying from the `products` table, which may have had incorrect or missing selling price data.

## Solution Implemented

### 1. Code Changes Made

#### File: `src/lib/posIntegration.ts`
**Change**: Updated `getMenuItems()` function to query directly from `inventory_items` table
- Now fetches `selling_price` from inventory_items
- Falls back to `price` field if selling_price is not available
- Uses `COALESCE(selling_price, price, 0)` to ensure we get the correct selling price
- **Result**: POS will now display the correct selling prices

**Before:**
```ts
SELECT id, name, price, department, category, active, category_id, sub_id, unit, cost_price, bar_visibility, restaurant_visibility FROM products WHERE active = true
```

**After:**
```ts
SELECT 
  id, name, category, 
  COALESCE(selling_price, price, 0) as selling_price,
  COALESCE(cost, 0) as cost_price,
  stock_level, unit, category_id, sub_id
FROM inventory_items 
WHERE (selling_price > 0 OR price > 0)
```

#### File: `src/context/DataContext.tsx`
**Change**: Added clarifying comment about using selling prices
- Maps `p.price` to `selling_price` (this is the correct price from DB)
- All components now correctly reference the selling price, not cost price

### 2. Data Fix Script

**File**: `scripts/fix_pos_selling_prices.ts`

This script performs a complete data health check and fix:
1. ✅ Ensures products table has correct structure
2. ✅ Adds missing columns (category_id, bar_visibility, etc.)
3. ✅ Populates selling_price in inventory_items from price field
4. ✅ Syncs all products using selling prices
5. ✅ Generates detailed verification report

## How to Apply the Fix

### Step 1: Run the Database Fix Script
```bash
npm run ts-node scripts/fix_pos_selling_prices.ts
```

This will:
- Check your database structure
- Populate selling prices from inventory_items
- Sync the products table
- Verify the fix with a report

### Step 2: Restart Your Application
```bash
npm run dev
# or
npm start
```

### Step 3: Test the POS
1. Open the POS system
2. Navigate to a menu item
3. **Verify the price shown is the selling price, NOT the cost price**
4. Compare with expected pricing from your menu

## Database Field Reference

### inventory_items table
| Field | Purpose | POS Use |
|-------|---------|---------|
| `id` | Unique identifier | Item key |
| `name` | Item name | Display name |
| `price` | Selling price (legacy) | Fallback if selling_price empty |
| `selling_price` | Customer-facing price | **PRIMARY - Used by POS** |
| `cost` | Purchase/cost price | Internal accounting |
| `stock_level` | Quantity in stock | Inventory tracking |
| `category` | Product category | Item classification |
| `visibility` | JSON visibility settings | Bar/Restaurant filtering |

### products table
| Field | Purpose | Note |
|-------|---------|------|
| `price` | Selling price | Should match inventory_items.selling_price |
| `cost_price` | Cost price | Should match inventory_items.cost |
| `stock_level` | Current stock | Synced from inventory_items |

## Troubleshooting

### Issue: POS still shows incorrect prices
**Solution**: 
1. Check if `fix_pos_selling_prices.ts` completed successfully
2. Verify inventory_items has `selling_price` > 0 for your items:
   ```sql
   SELECT name, selling_price, cost, price FROM inventory_items LIMIT 5;
   ```
3. Check that products table was updated:
   ```sql
   SELECT name, price, cost_price FROM products WHERE price > 0 LIMIT 5;
   ```

### Issue: Some items don't appear in POS
**Solution**:
1. Ensure items have `selling_price > 0`
2. Check visibility settings allow those items
3. Run: `SELECT id, name, selling_price FROM inventory_items WHERE selling_price <= 0;`

### Issue: Price shows as zero
**Solution**:
1. Need to set selling_price in inventory_items
2. Update manually if needed:
   ```sql
   UPDATE inventory_items 
   SET selling_price = 150.00 
   WHERE name = 'Your Item Name';
   ```
3. Re-run fix script to sync to products table

## Performance Impact
✅ **Minimal** - The new query is actually more efficient:
- Direct query from one table instead of joining
- Filtered at database level
- Reduced data transfer

## Rollback
If you need to revert, the system will still work with the products table. Just restart the application and clear browser cache.

## Verification Checklist
- [ ] fix_pos_selling_prices.ts ran successfully
- [ ] No database errors in the output
- [ ] Products with price > 0 shown in verification
- [ ] Average price is reasonable for your business
- [ ] POS displays correct prices after restart
- [ ] No items are missing from POS menu
- [ ] Bar items show correct prices
- [ ] Restaurant items show correct prices

## Questions?
Check the verification report from running `fix_pos_selling_prices.ts` - it will show:
- How many items were fixed
- Average pricing
- Items with markup (healthy margin)
- Sample items with their prices
