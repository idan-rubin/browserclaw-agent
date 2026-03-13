import { test, expect } from '@playwright/test';

test('full e2e: prompt → modal → run page → summary with skill', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('http://localhost:3000');
  await expect(page.locator('h1')).toContainText('browses');

  const textarea = page.locator('textarea');
  await textarea.fill('What is the cheapest flight from NYC to LAX tomorrow for 1 person on kayak.com');

  await page.locator('button', { hasText: 'Run' }).click();

  // Processing modal
  const modal = page.locator('text=Starting run');
  await expect(modal).toBeVisible({ timeout: 5000 });
  console.log('Processing modal visible');

  // Redirect to /run/{id}
  await page.waitForURL(/\/run\//, { timeout: 30000 });
  console.log('Redirected to:', page.url());

  // VNC iframe + cancel button in nav
  await expect(page.locator('iframe[title="Browser stream"]')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('nav button', { hasText: 'Cancel' })).toBeVisible({ timeout: 5000 });
  console.log('Run page: VNC + cancel button visible');

  // Wait for summary page (status badge appears when done)
  const statusBadge = page.locator('text=/Run completed|Run failed|Run timed out/');
  await expect(statusBadge).toBeVisible({ timeout: 120000 });
  console.log('Summary page visible');

  // Must have completed successfully
  await expect(page.locator('text=Run completed')).toBeVisible();

  // Stats should be present with real values
  await expect(page.locator('text=Duration')).toBeVisible();
  await expect(page.locator('text=Total steps')).toBeVisible();
  await expect(page.locator('text=Pages visited')).toBeVisible();

  // Steps timeline should have entries
  await expect(page.getByRole('heading', { name: 'Steps' })).toBeVisible();

  // Skill file should be generated
  await expect(page.locator('text=Skill')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('button', { hasText: 'Copy' })).toBeVisible();
  await expect(page.locator('button', { hasText: 'Download .md' })).toBeVisible();
  console.log('Skill output with Copy and Download buttons verified');

  // Back to home link
  await expect(page.locator('text=Back to home')).toBeVisible();
  console.log('Summary page fully verified');
});
