# Render Deployment Guide

## How Render Works

Render is connected to your GitHub repository and **automatically deploys** when you push code to the `main` branch.

## What Happens When You Push to Git:

1. ✅ **You push code to GitHub** (already done - commits `619416b` and `63be932`)
2. 🔄 **Render detects the changes** (usually within 1-2 minutes)
3. 🏗️ **Render automatically builds** your app (runs `npm install`, `npm run build`)
4. 🚀 **Render deploys** the new version (replaces the old one)
5. ✅ **Your site updates** at `https://villa-gianni-pms.onrender.com`

## You Don't Need to Do Anything!

Render handles it automatically. Just wait 5-10 minutes after pushing to GitHub.

## How to Check if Deployment is Complete:

### Option 1: Check Render Dashboard
1. Go to https://dashboard.render.com
2. Click on your "villa-gianni-pms" service
3. Look at the **Events** tab - you'll see:
   - ⏳ "Deploy started" (building)
   - ✅ "Deploy live" (completed)

### Option 2: Check Build Logs
1. In the Render dashboard, go to **Logs** tab
2. You'll see real-time build output
3. Wait for "Build successful" message

## Current Issue: $0.00 Prices

The items on production show **$0.00** because:

### Problem:
The CSV import script expects columns named:
- `SellingPrice` OR
- `Selling` OR  
- `Price`

If your CSV has different column names (like `selling_price`, `PRICE`, `cost`, etc.), the import sets price to $0.00.

### Solution:
You need to either:

1. **Update your CSV** to have a column named exactly `SellingPrice` or `Price`
2. **OR update the import script** to match your CSV column names

**What are the column names in your stocks.csv file?** Share the first row (headers) and I'll fix the import script to match.

## After Deployment Completes:

1. ✅ Go to `https://villa-gianni-pms.onrender.com`
2. ✅ Hard refresh: `Ctrl + Shift + R`
3. ✅ Login and test POS → Table 1
4. ✅ Products should now appear (if they have prices > $0)

## Timeline:

- **Push to Git**: ✅ Done
- **Render detects**: ~1-2 mins
- **Build**: ~5-10 mins
- **Deploy**: ~1-2 mins
- **Total**: ~10-15 mins from push

Check back in 15 minutes and your production site should have all the fixes!
