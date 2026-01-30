# Regression Test Cases

## POS Module

### 1. Order Persistence & Module Navigation
**Objective**: Verify that active POS orders persist when navigating between different application modules.

**Steps**:
1.  Open the **POS** module.
2.  Select an **Available** table (e.g., Table 1).
3.  Add items to the order (e.g., Food -> Burger).
4.  Click **Send to Kitchen** (or Save Order).
5.  Verify the table status changes to **Occupied**.
6.  Navigate to the **Front Office** module using the sidebar.
7.  Wait for the Front Office module to load.
8.  Navigate back to the **POS** module.
9.  Verify that Table 1 is still **Occupied**.
10. Click on Table 1.
11. **Expected Result**: The order details (items, total) are exactly as they were before navigation. The order is NOT lost.

**Status**: PASSED (Confirmed by User)

### 2. Table State Persistence (Clear/Payment)
**Objective**: Verify that tables correctly revert to "Available" status after clearing or payment, and maintain this status after reloading/navigation.

**Steps**:
1.  Open the **POS** module.
2.  Select an **Occupied** table with an active order.
3.  Click **Quick Settle** or **Clear**.
4.  Complete the payment or clear action.
5.  Verify the table status changes to **Available** immediately.
6.  Navigate to **Front Office** module.
7.  Navigate back to **POS** module.
8.  **Expected Result**: The table remains **Available**. It does NOT revert to "Occupied".

**Status**: PASSED (Fixed by implementing `closePosOrder` to sync `pos_orders` and `table_status` tables).
