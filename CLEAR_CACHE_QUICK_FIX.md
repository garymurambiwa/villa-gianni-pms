# 🔧 QUICK FIX: Clear Browser Cache (5 seconds)

If prices still revert after refresh, your browser has a stale cache. Fix it:

## Option 1: Browser Console (FASTEST)

1. Open DevTools: **F12**
2. Click **Console** tab
3. Paste and run:
   ```javascript
   localStorage.removeItem("corepms_pos_items"); location.reload();
   ```
4. Done! Page reloads with fresh data

## Option 2: Manual (Step by step)

1. Open DevTools: **F12**
2. Go to **Application** tab
3. In left sidebar, click **Local Storage**
4. Click on **http://localhost:8081** (or your URL)
5. Find key: `corepms_pos_items`
6. Right-click → Delete
7. Hard refresh: **Ctrl+Shift+R** (Windows) or **Cmd+Shift+R** (Mac)

## Option 3: Full Cache Clear

If above doesn't work, hard refresh to clear all caches:
- **Windows:** Ctrl+Shift+R
- **Mac:** Cmd+Shift+R
- **Firefox:** Ctrl+Shift+R + Ctrl+F5

---

## ✅ After Clearing Cache:

1. Edit a price in POS Settings
2. Save it
3. Refresh the page (normal refresh, not hard)
4. Price should PERSIST ✓

If price still reverts, let me know!
