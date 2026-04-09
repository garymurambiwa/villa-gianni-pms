# Inventory Module Operations Guide for Bar Staff

## Quick Overview
The new inventory system helps you track stock, receive deliveries, transfer items between bars, and monitor what you have on hand in real-time.

---

## ACCESSING THE INVENTORY MODULE

**Step 1:** Log into COREPMS at `http://localhost:8081`

**Step 2:** Look for **"Inventory"** in the left sidebar menu

**Step 3:** You'll land on the **Inventory Dashboard**

---

## TASK 1: CHECK CURRENT BAR STOCK LEVELS
*Use this when you need to know what's in stock right now*

1. From **Inventory Dashboard**
2. Look at the **"Stock Balance"** section
3. Select your bar location from the dropdown (e.g., "Bar 1", "Bar 2")
4. You'll see:
   - **Item Name** (e.g., "Vodka", "Red Wine", "Beer Cans")
   - **Current Quantity** (how much you have)
   - **Unit** (bottles, liters, cases)
   - **Location** (which bar/storage area)

💡 **TIP:** This updates in real-time as items are sold or transferred

---

## TASK 2: RECEIVE A NEW DELIVERY (GRN - Goods Receipt Note)
*Use this when you receive stock from a supplier*

### Step-by-step:

1. From **Inventory Dashboard**, click **"New GRN"** button (or find the GRN Form link)

2. You'll see a form with these fields:
   
   **Step A - Delivery Info:**
   - Select **Supplier Name** from dropdown
   - Enter **Delivery Date** (today's date usually)
   - Enter **Invoice Number** from the supplier (if available)
   - Select **Receiving Location** (e.g., "Main Cellar" or "Bar 1")

   **Step B - Add Items:**
   - Click **"Add Item Line"** button
   - For each item:
     - Search for **Item Name** (e.g., "Vodka Bottle 75cl")
     - Enter **Quantity** received (e.g., 12)
     - Enter **Unit Price** (what you paid per unit)
     - The system auto-calculates **Total Price** (Qty × Price)
   - Add as many lines as needed for your delivery

3. Click **"Save GRN"** when done

4. Your delivery is now recorded in the system

💡 **TIP:** Find the invoice or delivery note to get accurate item names and quantities

---

## TASK 3: CHECK RECENT DELIVERIES
*Use this to see what was recently received*

1. From **Inventory Dashboard**
2. Scroll down to **"Recent Transactions"** section
3. You'll see:
   - Date of delivery
   - Supplier name
   - Items received
   - Quantity

---

## TASK 4: TRANSFER STOCK BETWEEN BARS
*Use this when moving bottles/cases from Main Storage to your Bar*

### Step-by-step:

1. From **Inventory Dashboard**, click **"New Transfer"** button

2. Fill in the transfer form:

   **Step A - Transfer Details:**
   - Select **"From Location"** (e.g., "Main Cellar" where stock is stored)
   - Select **"To Location"** (e.g., "Bar 1" where you need it)
   - Enter **Transfer Date** (date you're moving it)

   **Step B - Select Items to Transfer:**
   - Click **"Add Item"** button
   - Search for the **Item Name** (e.g., "Red Wine")
   - Enter **Quantity** you want to move
   - System shows **"Available Stock"** to avoid requesting more than exists

   **Step C - Submit:**
   - Click **"Create Transfer"**
   - Your transfer is now pending manager approval

3. **Status Check:** Wait for manager/supervisor to approve the transfer
   - Once approved, the stock will be moved automatically
   - You'll see a notification when it's complete

💡 **TIP:** Only request what you actually need to avoid over-stocking

---

## TASK 5: CHECK VARIANCE (STOCK COUNTS VS SYSTEM)
*Use this when physical count doesn't match what the system says*

1. From **Inventory Dashboard**, click **"Variance Report"** button

2. You'll see:
   - **Theoretical Stock** = what the system thinks you should have
   - **Physical Stock** = what you actually counted
   - **Variance** = the difference (e.g., -5 bottles means 5 missing)
   - **Alert Level** = color code:
     - 🟢 **GREEN (OK):** Variance is normal (under 2%)
     - 🟡 **YELLOW (WARNING):** Small discrepancy (2-5%)
     - 🔴 **RED (CRITICAL):** Big discrepancy (over 5%)

3. If something's wrong:
   - Report to your manager with the item name and variance amount
   - Don't manually adjust anything

---

## TASK 6: CREATE RECIPE/BILL OF MATERIALS
*Use this if tracking mixed drinks or prepared items (optional for bar staff)*

⚠️ **Usually done by management/head chef**

If you need to track a signature cocktail or house drink:
1. From **Inventory**, click **"Recipe Builder"**
2. Enter drink name (e.g., "House Margarita")
3. Add ingredient lines:
   - Select ingredient (e.g., "Tequila")
   - Enter quantity used per drink (e.g., 2 oz)
   - Unit of Measure
4. Save recipe

---

## QUICK REFERENCE: Common Locations

| Location | What's stored there |
|----------|-------------------|
| **Main Cellar** | Primary storage, bulk inventory |
| **Dry Goods Store** | Bottled/packaged items |
| **Freezer** | Frozen items, ice |
| **Bar 1** | Bottles actively in use at Bar 1 |
| **Bar 2** | Bottles actively in use at Bar 2 |
| **Restaurant** | Items used in dining area |

---

## QUICK REFERENCE: Alert Colors in Variance

```
🟢 OK (Variance < 2%)
   → Normal breakage/spillage, don't worry

🟡 WARNING (Variance 2-5%)
   → Investigate, might be inventory error

🔴 CRITICAL (Variance > 5%)
   → Report to manager immediately, possible theft or major discrepancy
```

---

## TROUBLESHOOTING

**Q: I can't find an item in the dropdown**
- A: Check spelling, or ask manager to add the item to the system first

**Q: The transfer won't submit**
- A: Make sure:
  - Both locations are selected and different
  - Quantity is available in source location
  - All required fields are filled

**Q: I transferred stock but don't see it in my location**
- A: Wait for manager approval - transfer is pending review

**Q: Transfer is showing as "pending approval"**
- A: Ask your manager to approve it - you'll get notified when approved

---

## WHO TO CONTACT

- **System Issues:** Contact IT/Manager
- **Stock Discrepancies:** Report to manager during variance review
- **Missing Items in Dropdown:** Alert manager, they may need to add it
- **Approval Delays:** Follow up with shift manager

---

## GOLDEN RULES ✨

1. ✅ **Always receive deliveries in the system** - Don't put stock on shelf without logging it
2. ✅ **Request transfers officially** - Don't just take bottles from storage without a transfer
3. ✅ **Check stock before your shift** - Know what you have to serve customers
4. ✅ **Report variance immediately** - Helps catch problems early
5. ✅ **Use correct location** - "Bar 1" is different from "Main Cellar"

---

**Version:** v1.0  
**Last Updated:** April 9, 2026  
**Questions?** Ask your manager or IT team
