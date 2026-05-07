// Script to advance business date to current date and force reconciliation
// Current date: 2026-05-02

/**
 * Advance the business date to today's date and force reconciliation
 */
async function advanceBusinessDateAndReconcile() {
  console.log('Starting business date advancement and forced reconciliation...');
  
  // Today's date in ISO format
  const today = new Date().toISOString().slice(0, 10);
  console.log(`Setting business date to: ${today}`);
  
  try {
    // Step 1: Update business date in backend via API
    console.log('Updating business date in backend...');
    const dateUpdateResponse = await fetch('http://localhost:3001/api/db/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: `INSERT INTO system_configs (key, value, description, updated_at, updated_by)
              VALUES ('business_date', $1::jsonb, 'Current hotel business date', NOW(), 'manual_override')
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        params: [JSON.stringify({ date: today, rolled_at: new Date().toISOString() })]
      })
    });
    
    if (!dateUpdateResponse.ok) {
      throw new Error(`Failed to update business date: ${dateUpdateResponse.statusText}`);
    }
    console.log('✓ Business date updated in backend');
    
    // Note: localStorage update skipped in Node.js environment
    // The frontend will pick up the updated date on next load
    
    // Step 2: Force reconciliation by running night audit with force options
    console.log('Running forced reconciliation...');
    const nightAuditResponse = await fetch('http://localhost:3001/api/night-audit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true })
    });
    
    if (!nightAuditResponse.ok) {
      throw new Error(`Failed to trigger night audit: ${nightAuditResponse.statusText}`);
    }
    
    const result = await nightAuditResponse.json();
    console.log('✓ Forced reconciliation triggered:', result);
    
    // Step 3: Verify the date was set correctly
    console.log('Verifying business date...');
    const statusResponse = await fetch('http://localhost:3001/api/night-audit/status');
    if (!statusResponse.ok) {
      throw new Error(`Failed to get night audit status: ${statusResponse.statusText}`);
    }
    
    const status = await statusResponse.json();
    console.log('Current night audit status:', status);
    
    if (status.businessDate === today) {
      console.log('✓ Business date successfully aligned with current date');
    } else {
      console.warn(`⚠ Business date mismatch. Expected: ${today}, Got: ${status.businessDate}`);
    }
    
    console.log('Process completed successfully!');
    return { success: true, businessDate: today };
    
  } catch (error) {
    console.error('❌ Error during business date advancement:', error);
    return { success: false, error: error.message };
  }
}

// Execute the function
advanceBusinessDateAndReconcile().then(result => {
  if (result.success) {
    console.log('🎉 Business date advancement and reconciliation completed successfully');
  } else {
    console.error('💥 Process failed:', result.error);
  }
});