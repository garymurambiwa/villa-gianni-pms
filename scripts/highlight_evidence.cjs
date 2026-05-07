
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const ARTIFACTS_DIR = 'C:\\Users\\Infinity\\.gemini\\antigravity\\brain\\79a33b9e-8dbc-4306-acca-ece153fea532';

(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: { width: 1280, height: 800 }
    });
    const page = await browser.newPage();

    try {
        // 1. Login
        await page.goto('http://localhost:8081', { waitUntil: 'networkidle0' });
        if (await page.$('input[type="text"]')) { // Assuming username field present
            await page.type('input[type="text"]', 'admin');
            await page.type('input[type="password"]', 'test123');
            await Promise.all([
                page.click('button[type="submit"]'),
                page.waitForNavigation({ waitUntil: 'networkidle0' })
            ]);
        }

        // 2. Capture Inventory Highlight
        console.log('Navigating to Inventory...');
        // Find inventory link text or icon, or navigate URL directly if known. Assuming sidebar is present.
        // Try navigating to Inventory via URL if possible, or click.
        // Let's assume standard nav:
        const invLink = await page.$x("//a[contains(., 'Inventory')]");
        if (invLink.length > 0) {
            await invLink[0].click();
        } else {
            // Fallback: try direct ID or class if known, or just look for "Inventory" text
            const elements = await page.$$('*');
            for (const el of elements) {
                const text = await page.evaluate(e => e.innerText, el);
                if (text === 'Inventory') {
                    await el.click();
                    break;
                }
            }
        }

        await page.waitForSelector('table', { timeout: 5000 });
        // Highlight rows
        await page.evaluate(() => {
            document.querySelectorAll('tbody tr').forEach((row, i) => {
                if (i < 5) row.style.border = '5px solid red';
            });
        });
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'inventory_highlighted.png') });

        // 3. Capture POS Highlight
        console.log('Navigating to POS...');
        const posLink = await page.$x("//a[contains(., 'Point of Sale')]");
        if (posLink.length > 0) {
            await posLink[0].click();
        } else {
            const elements = await page.$$('*');
            for (const el of elements) {
                const text = await page.evaluate(e => e.innerText, el);
                if (text === 'Point of Sale' || text.includes('POS')) {
                    await el.click();
                    break;
                }
            }
        }

        // Wait for table selection or direct POS
        await new Promise(r => setTimeout(r, 2000)); // Wait for render

        // Check if table selection modal is open or we need to click a table
        const tableBtn = await page.$x("//button[contains(., 'Table 1')]");
        if (tableBtn.length > 0) {
            await tableBtn[0].click();
        }

        await new Promise(r => setTimeout(r, 1000)); // Wait for modal

        // Click 'Bar' Tab
        const barTab = await page.$x("//button[contains(., 'Bar')]");
        if (barTab.length > 0) {
            await barTab[0].click();
        }

        await new Promise(r => setTimeout(r, 1000)); // Wait for items

        // Highlight items
        await page.evaluate(() => {
            // Assume items are in a grid, maybe buttons or cards
            const items = document.querySelectorAll('button');
            items.forEach(btn => {
                if (
                    btn.innerText.includes('VODKA') ||
                    btn.innerText.includes('GIN') ||
                    btn.innerText.includes('WHISKY') ||
                    btn.innerText.includes('BEER')
                ) {
                    btn.style.border = '5px solid red';
                    btn.style.boxShadow = '0 0 15px red';
                }
            });
        });

        await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'pos_highlighted.png') });

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await browser.close();
    }
})();
