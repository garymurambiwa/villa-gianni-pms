#!/usr/bin/env node

/**
 * Debug variance report generation
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function debugVarianceReports() {
  const client = await pool.connect();

  try {
    console.log('=== VARIANCE REPORT DEBUG ===');

    // Check existing reports
    const existingReports = await client.query(
      'SELECT id, report_number, inserted_at FROM public.inv_variance_reports ORDER BY inserted_at DESC LIMIT 10'
    );

    console.log('Existing reports:');
    existingReports.rows.forEach(row => {
      console.log(`  ${row.report_number} (${row.id}) - ${row.inserted_at}`);
    });

    // Check the sequence logic
    const currentYear = new Date().getFullYear();
    const countRes = await client.query(
      `SELECT COUNT(*) as total_reports FROM public.inv_variance_reports WHERE report_number LIKE $1`,
      [`VAR-${currentYear}-%`]
    );

    console.log(`\nTotal reports for ${currentYear}: ${countRes.rows[0].total_reports}`);

    // Test the sequence calculation
    console.log(`\nTesting sequence calculation for pattern: VAR-${currentYear}-%`);

    // Let's see what the substring actually extracts
    const substringTest = await client.query(
      `SELECT report_number, SUBSTRING(report_number FROM 10) as extracted,
       CAST(SUBSTRING(report_number FROM 10) AS INTEGER) as casted
       FROM public.inv_variance_reports
       WHERE report_number LIKE $1`,
      [`VAR-${currentYear}-%`]
    );

    console.log('Substring extraction test (FROM 10):');
    substringTest.rows.forEach(row => {
      console.log(`  ${row.report_number} -> '${row.extracted}' -> ${row.casted}`);
    });

    const seqRes = await client.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(report_number FROM 10) AS INTEGER)), 0) + 1 as next_num
       FROM public.inv_variance_reports
       WHERE report_number LIKE $1`,
      [`VAR-${currentYear}-%`]
    );

    const nextNum = seqRes.rows[0].next_num;
    console.log(`Next sequence number: ${nextNum}`);

    const proposedReportNumber = `VAR-${currentYear}-${String(nextNum).padStart(4, '0')}`;
    console.log(`Proposed report number: ${proposedReportNumber}`);

    // Check if this number already exists
    const existsRes = await client.query(
      'SELECT COUNT(*) as exists_count FROM public.inv_variance_reports WHERE report_number = $1',
      [proposedReportNumber]
    );

    console.log(`Report number already exists: ${existsRes.rows[0].exists_count > 0}`);

  } finally {
    client.release();
    await pool.end();
  }
}

debugVarianceReports().catch(console.error);