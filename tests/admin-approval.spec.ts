import { test, expect } from '@playwright/test';

test('Admin Approval via Direct Link workflow', async ({ page }) => {
  // Navigate to app and open Register
  await page.goto('/');
  await page.getByRole('button', { name: /register/i }).click();
  // Fill minimal registration form
  await page.getByLabel('Username').fill('e2e_user');
  await page.getByLabel('Email').fill('e2e@example.com');
  await page.getByLabel('Password').fill('Password123');
  await page.getByLabel('Full Name').fill('E2E User');
  await page.getByLabel('Phone').fill('123456789');
  await page.getByLabel('Role').selectOption('manager');
  // Submit for approval
  await page.getByRole('button', { name: /submit for approval/i }).click();

  // Wait for a status badge to appear
  const status = page.getByRole('status');
  await expect(status).toBeVisible();

  // Extract approvalId from UI by reading text content that includes ID (if exposed)
  // For demonstration, navigate to a mocked approval link using a placeholder id
  const approvalId = 'A_LINK_DEMO';
  await page.goto(`/#/approve/${approvalId}/TOK123`);

  // Perform approval via direct link page
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/Approval completed successfully/i)).toBeVisible();
});
