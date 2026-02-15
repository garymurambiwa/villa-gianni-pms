// Debug script to verify localStorage persistence
console.log('=== CHECKING LOCALSTORAGE ===\n');

try {
    const posItems = localStorage.getItem('corepms_pos_items');

    if (!posItems) {
        console.log('❌ NO DATA in localStorage.corepms_pos_items');
    } else {
        const items = JSON.parse(posItems);
        console.log(`✅ Found ${items.length} items in localStorage`);

        // Group by category
        const byCategory = {};
        items.forEach(item => {
            const cat = item.category || 'unknown';
            if (!byCategory[cat]) byCategory[cat] = [];
            byCategory[cat].push(item);
        });

        console.log('\nBreakdown by category:');
        Object.keys(byCategory).forEach(cat => {
            console.log(`  ${cat}: ${byCategory[cat].length} items`);
        });

        // Show first 5 bar items
        const barItems = items.filter(i => i.category === 'bar');
        console.log(`\nFirst 5 Bar items:`);
        barItems.slice(0, 5).forEach(item => {
            console.log(`  - ${item.name} (category_id: ${item.category_id})`);
        });

        // Show first 5 restaurant items
        const restItems = items.filter(i => i.category === 'restaurant');
        console.log(`\nFirst 5 Restaurant items:`);
        restItems.slice(0, 5).forEach(item => {
            console.log(`  - ${item.name} (category_id: ${item.category_id})`);
        });
    }
} catch (err) {
    console.error('Error reading localStorage:', err);
}

console.log('\n=== TO RUN THIS ===');
console.log('1. Open browser DevTools (F12)');
console.log('2. Go to Console tab');
console.log('3. Copy and paste this entire script');
console.log('4. Press Enter');
