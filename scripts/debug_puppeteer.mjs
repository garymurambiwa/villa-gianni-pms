import puppeteer from 'puppeteer';

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    const logs = [];
    page.on('console', msg => {
        const text = msg.text();
        if (text.includes('[POS Items Debug]') || text.includes('[OrderModal Debug]')) {
            logs.push(text);
            console.log('BROWSER LOG:', text);
        }
    });

    try {
        console.log("Navigating to login...");
        await page.goto('http://localhost:8081/');

        await page.waitForSelector('input[placeholder*="sername"]', { timeout: 5000 });
        await page.type('input[placeholder*="sername"]', 'admin');
        await page.type('input[type="password"]', 'admin');
        await page.click('button[type="submit"]');

        await page.waitForTimeout(2000);

        console.log("Navigating to POS...");
        await page.goto('http://localhost:8081/pos', { waitUntil: 'networkidle0' });

        // Wait for the tables to load
        await page.waitForSelector('.cursor-pointer', { timeout: 10000 });
        const tableCards = await page.$$('.cursor-pointer');

        if (tableCards.length > 0) {
            console.log("Clicking table 1...");
            await tableCards[0].click();
            await page.waitForTimeout(1000);

            console.log("Looking for Bar tab...");
            const tabs = await page.$$('button[role="tab"]');
            for (const tab of tabs) {
                const text = await page.evaluate(el => el.textContent, tab);
                if (text && text.toLowerCase().includes('bar')) {
                    console.log("Clicking Bar tab...");
                    await tab.click();
                    break;
                }
            }
            await page.waitForTimeout(3000); // let it log
        } else {
            console.log("No tables found.");
        }

    } catch (err) {
        console.error("Script error:", err);
    } finally {
        console.log("TOTAL LOGS CAPTURED:", logs.length);
        await browser.close();
    }
})();
