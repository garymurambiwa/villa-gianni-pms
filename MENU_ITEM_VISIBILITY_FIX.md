# Menu Item Visibility Fix Documentation

## Issue Summary
The ABSOLUTE VODKA menu item (and similar items) were not correctly saving visibility and location settings. When changes were made through the system interface:
- Location showed "Restaurant" instead of "Bar" (Center)
- Visibility showed "Bar:No" and "Restaurant:No" instead of "Bar:Yes"
- Changes were confirmed as saved but the displayed values remained unchanged

## Root Cause Analysis

### 1. Missing Type Field in Save
When saving items in PosSettings, the `type` field (used to determine department) was not being passed to the database sync function. This caused the sync to default to 'Restaurant'.

**Location**: `src/components/modules/PosSettings.tsx` - `saveStockItem()` function

### 2. No Auto-Assignment for Bar Items
When an item was assigned to the Bar cost center, the visibility was not automatically set to Bar:Yes. Users had to manually check the visibility checkbox.

**Location**: `src/components/modules/PosSettings.tsx` - `saveStockItem()` function

### 3. Migration Logic Overwriting Visibility
The inventory category migration logic was overwriting explicit visibility settings based on the cost center, which could reset user-selected visibility values.

**Location**: `src/components/modules/PosSettings.tsx` - `migrateInventoryCategories()` function (lines 1358-1374)

## Changes Made

### 1. Modified `saveStockItem()` in PosSettings.tsx
Added auto-assignment of Bar visibility when costCenter is 'bar':
```typescript
// FIX: Auto-assign Bar visibility when costCenter is 'bar'
const effectiveBarVisible = costCenter === 'bar' ? true : barVisible;
const effectiveRestaurantVisible = costCenter === 'restaurant' ? true : restaurantVisible;

// Include type field for proper department handling
type: costCenter === 'bar' ? 'Bar' : (costCenter === 'restaurant' ? 'Restaurant' : ''),

// Use effective visibility with auto-assignment
visibility: { bar: effectiveBarVisible, restaurant: effectiveRestaurantVisible },
```

### 2. Fixed Migration Logic in PosSettings.tsx
Changed the visibility calculation to preserve explicit user settings:
```typescript
// FIX: Don't overwrite explicit visibility settings
const vis = {
  bar: it.visibility?.bar !== undefined ? !!it.visibility?.bar : (isBar ? true : !!it.visibility?.bar),
  restaurant: it.visibility?.restaurant !== undefined ? !!it.visibility?.restaurant : (center === 'restaurant' ? true : !!it.visibility?.restaurant),
};
```

### 3. Added Database Fix Functions in dbSync.ts
Added two new functions for fixing visibility in the database:
- `fixItemVisibility(itemId, costCenter, targetVisibility)` - Fix a specific item
- `fixAllItemsVisibility()` - Fix all items with incorrect visibility

### 4. Added UI Fix Functions in PosSettings.tsx
Added functions to trigger the fixes from the UI:
- `fixVisibilityInDatabase()` - Calls fixAllItemsVisibility()
- `fixSpecificItem()` - Fix a specific item by ID

## How to Use

### For New Items
When creating a new item:
1. Select "Bar" as the Cost Center
2. The system will automatically set visibility to Bar:Yes
3. Save the item - it will correctly show Bar location and Bar:Yes visibility

### For Existing Items (including ABSOLUTE VODKA)
To fix existing items with incorrect visibility:
1. Open PosSettings in the application
2. Navigate to the Stock Items tab
3. Find the item (ABSOLUTE VODKA)
4. Edit the item and ensure Cost Center is set to "bar"
5. Save the item - the visibility will now auto-set to Bar:Yes
6. The fix functions can also be called programmatically if needed

### Programmatic Fix
The fix functions can be called from the UI or programmatically:
```typescript
import { fixItemVisibility, fixAllItemsVisibility } from '@/lib/dbSync';

// Fix all items
const result = await fixAllItemsVisibility();

// Fix specific item
await fixItemVisibility('ITEM_ID', 'bar', { bar: true, restaurant: false });
```

## Files Modified

1. **src/components/modules/PosSettings.tsx**
   - Modified `saveStockItem()` to auto-assign visibility and include type field
   - Modified `migrateInventoryCategories()` to preserve explicit visibility
   - Added `fixVisibilityInDatabase()` and `fixSpecificItem()` functions

2. **src/lib/dbSync.ts**
   - Added `fixItemVisibility()` function
   - Added `fixAllItemsVisibility()` function

## Testing

To verify the fix works:
1. Create a new item with Cost Center = "bar"
2. Verify visibility automatically shows "Bar: Yes"
3. Save the item
4. Reload the page
5. Verify the visibility settings persisted correctly in the database

For ABSOLUTE VODKA specifically:
1. Edit the item in PosSettings
2. Set Cost Center to "bar"
3. Save
4. Verify it now shows Bar location with Bar:Yes visibility
