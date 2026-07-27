import { test, expect, type Page } from '@playwright/test';

const BASE_URL = 'http://mtpc_test:4096';
const TIMESTAMP = Date.now();

test.afterEach(async ({ page }, testInfo) => {
  const { mkdirSync } = await import('node:fs');
  const dir = testInfo.outputDir + '/screenshots';
  try { mkdirSync(dir, { recursive: true }); } catch {}
  const name = testInfo.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const suffix = testInfo.status === 'passed' ? 'pass' : 'fail';
  await page.screenshot({ path: dir + '/' + name + '_' + suffix + '.png', fullPage: true }).catch(() => {});
});

test.describe('Add Standard Page in Drupal', () => {

  test.describe('Authentication', () => {

    test('TC01: Verify user must authenticate before adding a page', async ({ page }) => {
      await page.goto(`${BASE_URL}/node/add/page`);

      await expect(page).toHaveURL(/login|sso|cas|auth/i);
    });
  });

  test.describe('Page Creation Form', () => {

    test.beforeEach(async ({ page }) => {
      await page.goto(`${BASE_URL}/user/login`);
      await page.getByRole('textbox', { name: 'Username' }).fill('content_editor');
      await page.getByRole('textbox', { name: 'Password' }).fill('password');
      await page.getByRole('button', { name: 'Log in' }).click();
      await page.waitForURL(`${BASE_URL}/**`);
    });

    test('TC02: Verify Add Standard Page form loads correctly', async ({ page }) => {
      await page.goto(`${BASE_URL}/node/add/page`);

      await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Body' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();
    });

    test('TC03: Create a standard page with required fields only', async ({ page }) => {
      await page.goto(`${BASE_URL}/node/add/page`);

      const title = `Test Page ${TIMESTAMP}`;
      await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
      await page.getByRole('textbox', { name: 'Body' }).fill('This is a test page body content.');
      await page.getByRole('button', { name: 'Save', exact: true }).click();

      await expect(page.getByText('has been created', { exact: false })).toBeVisible();
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
    });

    test('TC04: Create a standard page with custom URL alias', async ({ page }) => {
      await page.goto(`${BASE_URL}/node/add/page`);

      const title = `Custom URL Page ${TIMESTAMP}`;
      const urlAlias = `/custom-page-path-${TIMESTAMP}`;

      await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
      await page.getByRole('textbox', { name: 'Body' }).fill('Page with custom URL alias.');
      await page.getByRole('textbox', { name: 'URL alias' }).fill(urlAlias);
      await page.getByRole('button', { name: 'Save', exact: true }).click();

      await expect(page).toHaveURL(new RegExp(urlAlias.replace('/', '\\/')));
    });

    test('TC05: Validate required field - Title', async ({ page }) => {
      await page.goto(`${BASE_URL}/node/add/page`);

      await page.getByRole('textbox', { name: 'Body' }).fill('Body without title.');
      await page.getByRole('button', { name: 'Save', exact: true }).click();

      await expect(page.getByText('Title field is required.', { exact: false })).toBeVisible();
    });

    test('TC06: Test page preview functionality', async ({ page }) => {
      await page.goto(`${BASE_URL}/node/add/page`);

      const title = `Preview Page ${TIMESTAMP}`;
      const body = 'Preview test body content.';
      await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
      await page.getByRole('textbox', { name: 'Body' }).fill(body);
      await page.getByRole('button', { name: 'Preview', exact: true }).click();

      await expect(page.getByText(title, { exact: false })).toBeVisible();
      await expect(page.getByText(body, { exact: false })).toBeVisible();

      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title);
      await expect(page.getByRole('textbox', { name: 'Body' })).toHaveValue(body);
    });

    test('TC07: Create page with rich text formatting', async ({ page }) => {
      await page.goto(`${BASE_URL}/node/add/page`);

      const title = `Rich Text Page ${TIMESTAMP}`;
      await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
      await page.getByRole('textbox', { name: 'Body' }).fill(
        'This is **bold** and *italic* text with [a link](http://example.com).\n\n' +
        '## Heading 2\n\n' +
        '- List item 1\n' +
        '- List item 2'
      );
      await page.getByRole('button', { name: 'Save', exact: true }).click();

      await expect(page.getByText('has been created', { exact: false })).toBeVisible();
      await expect(page.getByText('bold', { exact: false })).toBeVisible();
      await expect(page.getByText('italic', { exact: false })).toBeVisible();
      await expect(page.getByRole('link', { name: 'a link' })).toBeVisible();
    });
  });
});