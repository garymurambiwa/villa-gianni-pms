/**
 * POS Financial Calculation Audit Script
 * Verifies tax-inclusive math and revenue splits.
 */

function calculateTaxInclusive(total, taxRate) {
    const tax = total * (taxRate / (100 + taxRate));
    const subtotal = total - tax;
    return {
        total: Number(total.toFixed(2)),
        tax: Number(tax.toFixed(2)),
        subtotal: Number(subtotal.toFixed(2))
    };
}

function auditCalculations() {
    console.log("--- POS Calculation Audit ---");
    
    // Case 1: 15% Tax on $100 total
    const case1 = calculateTaxInclusive(100, 15);
    console.log("Case 1 ($100 at 15%):", case1);
    const expectedTax1 = 100 * (15 / 115); // 13.043...
    if (case1.tax === 13.04 && case1.subtotal === 86.96) {
        console.log("✅ Case 1 Passed");
    } else {
        console.log("❌ Case 1 Failed");
    }

    // Case 2: 0% Tax on $50 total
    const case2 = calculateTaxInclusive(50, 0);
    console.log("Case 2 ($50 at 0%):", case2);
    if (case2.tax === 0 && case2.subtotal === 50) {
        console.log("✅ Case 2 Passed");
    } else {
        console.log("❌ Case 2 Failed");
    }

    console.log("\n--- Revenue Split Audit ---");
    const transactions = [
        { outlet: 'bar', amount: 40 },
        { outlet: 'restaurant', amount: 60 },
        { outlet: 'bar', amount: 20 }
    ];
    
    const barSales = transactions.filter(t => t.outlet === 'bar').reduce((s, t) => s + t.amount, 0);
    const restaurantSales = transactions.filter(t => t.outlet !== 'bar').reduce((s, t) => s + t.amount, 0);
    
    console.log(`Actual Bar Sales: ${barSales} (Expected 60)`);
    console.log(`Actual Restaurant Sales: ${restaurantSales} (Expected 60)`);
    
    if (barSales === 60 && restaurantSales === 60) {
        console.log("✅ Revenue Split Logic Passed");
    } else {
        console.log("❌ Revenue Split Logic Failed");
    }
}

auditCalculations();
