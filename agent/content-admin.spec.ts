import { test, expect } from '@playwright/test';

test.afterEach(async ({ page }, testInfo) => {
  const { mkdirSync } = await import('node:fs');
  const dir = testInfo.outputDir + '/screenshots';
  try { mkdirSync(dir, { recursive: true }); } catch {}
  const name = testInfo.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const suffix = testInfo.status === 'passed' ? 'pass' : 'fail';
  await page.screenshot({ path: dir + '/' + name + '_' + suffix + '.png', fullPage: true }).catch(() => {});
});

test.describe('Content Administration Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/content');
  });

  test('TC01 - Page loads and displays content table', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Content', level: 1 })).toBeVisible();
    await expect(page.getByRole('table').first()).toBeVisible();
  });

  test('TC02 - Filter content by title', async ({ page }) => {
    await page.getByRole('textbox', { name: 'Title' }).fill('Testing');
    await page.getByRole('button', { name: 'Filter' }).click();
    const table = page.getByRole('table').first();
    await expect(table).toBeVisible();
    const rows = table.locator('tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i)).toContainText('Testing');
    }
  });

  test('TC03 - Filter content by content type', async ({ page }) => {
    await page.getByRole('combobox', { name: 'Content type' }).selectOption({ label: 'News' });
    await page.getByRole('button', { name: 'Filter' }).click();
    const table = page.getByRole('table').first();
    await expect(table).toBeVisible();
    const rows = table.locator('tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i)).toContainText('News');
    }
  });

  test('TC04 - Filter content by published status', async ({ page }) => {
    await page.getByRole('combobox', { name: 'Published status' }).selectOption({ label: 'Published' });
    await page.getByRole('button', { name: 'Filter' }).click();
    const table = page.getByRole('table').first();
    await expect(table).toBeVisible();
    const rows = table.locator('tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i)).toContainText('Published');
    }
  });

  test('TC05 - Filter content by language', async ({ page }) => {
    await page.getByRole('combobox', { name: 'Language' }).selectOption({ label: 'English' });
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByRole('table').first()).toBeVisible();
  });

  test('TC06 - Sort table by title ascending', async ({ page }) => {
    const titleHeader = page.getByRole('table').first().locator('th').getByRole('link', { name: 'Title' });
    await titleHeader.click();
    await expect(page).toHaveURL(/order=title&sort=asc/);
  });

  test('TC07 - Sort table by updated date', async ({ page }) => {
    const updatedHeader = page.getByRole('table').first().locator('th').getByRole('link', { name: 'Updated' });
    await updatedHeader.click();
    await expect(page).toHaveURL(/order=changed&sort=asc/);
  });

  test('TC08 - Sort table by content type', async ({ page }) => {
    const typeHeader = page.getByRole('table').first().locator('th').getByRole('link', { name: 'Content type' });
    await typeHeader.click();
    await expect(page).toHaveURL(/order=type&sort=asc/);
  });

  test('TC09 - Select all rows with checkbox', async ({ page }) => {
    const selectAll = page.getByRole('checkbox', { name: 'Select all rows in this table' });
    await selectAll.check();
    const rowCheckboxes = page.getByRole('table').first().locator('tbody').getByRole('checkbox');
    const count = await rowCheckboxes.count();
    for (let i = 0; i < count; i++) {
      await expect(rowCheckboxes.nth(i)).toBeChecked();
    }
  });

  test('TC10 - Edit a content item', async ({ page }) => {
    await page.getByRole('link', { name: 'Edit Testing Page' }).click();
    await expect(page).toHaveURL(/\/node\/\d+\/edit/);
  });

  test('TC11 - Navigate via primary tabs', async ({ page }) => {
    const tabs = page.getByRole('navigation', { name: 'Tabs' });
    await expect(tabs.getByRole('link', { name: 'Content' })).toBeVisible();
    await tabs.getByRole('link', { name: 'Blocks' }).click();
    await expect(page).toHaveURL(/\/admin\/content\/block/);
  });

  test('TC12 - Navigate via secondary tabs', async ({ page }) => {
    await page.getByRole('link', { name: 'Scheduled content' }).click();
    await expect(page).toHaveURL(/\/admin\/content\/scheduled/);
  });

  test('TC13 - Breadcrumb navigation', async ({ page }) => {
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(breadcrumb).toContainText('Home');
    await expect(breadcrumb).toContainText('Administration');
    await expect(breadcrumb).toContainText('Content');
    await breadcrumb.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page).toHaveURL('/');
  });

  test('TC14 - Add content action', async ({ page }) => {
    await page.getByRole('link', { name: '+Add content' }).click();
    await expect(page).toHaveURL(/\/node\/add/);
  });

  test('TC15 - Add content as MTPC action', async ({ page }) => {
    await page.getByRole('link', { name: '+Add content as MTPC' }).click();
    await expect(page).toHaveURL(/\/node\/add-list\/mtpc/);
  });

  test('TC16 - Combined filter by title and content type', async ({ page }) => {
    await page.getByRole('textbox', { name: 'Title' }).fill('Template');
    await page.getByRole('combobox', { name: 'Content type' }).selectOption({ label: 'Template' });
    await page.getByRole('button', { name: 'Filter' }).click();
    const table = page.getByRole('table').first();
    await expect(table).toBeVisible();
    const rows = table.locator('tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i)).toContainText('Template');
    }
  });

  test('TC17 - Sidebar menu links are functional', async ({ page }) => {
    await page.getByRole('link', { name: 'View all Contents' }).click();
    await expect(page).toHaveURL(/\/admin\/mtpc\/content/);
  });

  test('TC18 - Logout link availability', async ({ page }) => {
    const userAccountMenu = page.getByRole('link', { name: 'User Account', exact: true });
    await userAccountMenu.click();
    await expect(page.getByRole('link', { name: 'Logout' })).toBeVisible();
  });

  test('TC19 - Content item displays correct metadata', async ({ page }) => {
    const table = page.getByRole('table').first();
    const testingPageRow = table.locator('tr').filter({ hasText: 'Testing Page' }).first();
    await expect(testingPageRow).toBeVisible();
    await expect(testingPageRow).toContainText('Standard Page');
    await expect(testingPageRow).toContainText('Published');
    await expect(testingPageRow).toContainText('System Administrator');
  });

  test('TC20 - Toolbar buttons are present and accessible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Manage' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Shortcuts' })).toBeVisible();
  });
});
