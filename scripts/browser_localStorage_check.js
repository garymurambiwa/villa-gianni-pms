/**
 * POS localStorage Verification Script
 * 
 * INSTRUCTIONS:
 * 1. Open browser to http://localhost:8081
 * 2. Login to the system
 * 3. Open DevTools (F12)
 * 4. Go to Console tab
 * 5. Copy and paste this ENTIRE script
 * 6. Press Enter
 */

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║     POS LOCALSTORAGE VERIFICATION (Browser Console)       ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

try {
    // Check if dataExists
    const rawData = localStorage.getItem('corepms_pos_items');

    if (!rawData) {
        console.log('❌ NO DATA FOUND in localStorage.corepms_pos_items');
        console.log('\n   This means:');
        console.log('   - DataContext.loadAllData() has not run yet');
        console.log('   - OR the dev server needs to be restarted');
        console.log('   - OR there was an error loading data\n');
        console.log('   SOLUTION:');
        console.log('   1. Restart dev server');
        console.log('   2. Hard refresh browser (Ctrl+Shift+R)');
        console.log('   3. Login again');
        console.log('   4. Run this script again\n');
    } else {
        const items = JSON.parse(rawData);
        console.log(`✅ Found ${items.length} items in localStorage\n`);

        // Check category field distribution
        const categoryCount = {};
        const categoryIdCount = {};
        const withoutCategory = [];
        const withoutCategoryId = [];

        items.forEach(item => {
            // Count by category (should be 'bar' or 'restaurant')
            const cat = item.category || 'MISSING';
            categoryCount[cat] = (categoryCount[cat] || 0) + 1;
            if (!item.category) withoutCategory.push(item.name);

            // Count by category_id
            const catId = item.category_id || 'MISSING';
            categoryIdCount[catId] = (categoryIdCount[catId] || 0) + 1;
            if (!item.category_id) withoutCategoryId.push(item.name);
        });

        console.log('📊 Category Field Distribution (for dept filter):');
        Object.keys(categoryCount).sort().forEach(cat => {
            const icon = cat === 'MISSING' ? '❌' : '✅';
            console.log(`   ${icon} category="${cat}": ${categoryCount[cat]} items`);
        });

        console.log('\n📊 Category ID Distribution (for subcategory filter):');
        Object.keys(categoryIdCount).sort().forEach(catId => {
            const icon = catId === 'MISSING' ? '❌' : '✅';
            console.log(`   ${icon} category_id="${catId}": ${categoryIdCount[catId]} items`);
        });

        // Show sample items
        console.log('\n📋 Sample Bar Items:');
        items.filter(i => i.category === 'bar').slice(0, 5).forEach(item => {
            console.log(`   - ${item.name} (category_id: ${item.category_id || 'MISSING'})`);
        });

        console.log('\n📋 Sample Restaurant Items:');
        items.filter(i => i.category === 'restaurant').slice(0, 5).forEach(item => {
            console.log(`   - ${item.name} (category_id: ${item.category_id || 'MISSING'})`);
        });

        // Diagnostics
        console.log('\n\n╔════════════════════════════════════════════════════════════╗');
        console.log('║                      DIAGNOSTICS                           ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');

        if (withoutCategory.length > 0) {
            console.log(`❌ ${withoutCategory.length} items missing "category" field`);
            console.log('   These will NOT appear in OrderModal!');
            console.log('   Items:', withoutCategory.slice(0, 10).join(', '));
            console.log('\n   FIX: Restart dev server to apply DataContext fix\n');
        } else {
            console.log('✅ All items have "category" field correctly set\n');
        }

        if (withoutCategoryId.length > 0) {
            console.log(`⚠️  ${withoutCategoryId.length} items missing "category_id" field`);
            console.log('   These may not filter correctly by subcategory');
            console.log('   Items:', withoutCategoryId.slice(0, 10).join(', '));
            console.log('\n   FIX: Restart dev server to apply DataContext fix\n');
        } else {
            console.log('✅ All items have "category_id" field correctly set\n');
        }

        // Expected behavior
        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║                   EXPECTED BEHAVIOR                        ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');
        console.log('   When you open POS → Table 1:');
        console.log(`   ✅ Bar → General: Should show ${categoryIdCount['CAT_BAR_GEN'] || 0} items`);
        console.log(`   ✅ Bar → Beverages: Should show ${categoryIdCount['CAT_BAR_BEV'] || 0} items`);
        console.log(`   ✅ Restaurant → General: Should show ${categoryIdCount['CAT_REST_GEN'] || 0} items`);
        console.log(`   ✅ Restaurant → Mains: Should show ${categoryIdCount['CAT_REST_MAIN'] || 0} items`);
        console.log('\n   Data should PERSIST after:');
        console.log('   - Page refresh (F5)');
        console.log('   - Browser restart');
        console.log('   - Opening in new tab/window\n');
    }
} catch (err) {
    console.error('❌ Error reading localStorage:', err);
    console.log('\n   Check if localStorage is enabled in your browser\n');
}

console.log('════════════════════════════════════════════════════════════\n');
