import { test } from '@playwright/test';

test.afterEach(async ({ page }, testInfo) => {
  const { mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  // Write to a persistent directory (SCREENSHOT_OUTPUT or ./run/screenshots)
  // instead of testInfo.outputDir, which Playwright deletes for passing tests.
  const dir = process.env.SCREENSHOT_OUTPUT || join(process.cwd(), 'run', 'screenshots');
  try { mkdirSync(dir, { recursive: true }); } catch {}
  const name = testInfo.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const suffix = testInfo.status === 'passed' ? 'pass' : 'fail';
  await page.screenshot({ path: join(dir, name + '_' + suffix + '.png'), fullPage: true }).catch(() => {});
});
