import { test, expect, type Page } from '@playwright/test';

export async function revealButton(page: Page, name: string): Promise<boolean> {
  const btn = page.getByRole('button', { name });
  if ((await btn.count()) && (await btn.first().isVisible().catch(() => false))) return true;
  const reveal = page.getByRole('button', { name: 'List additional actions' });
  const n = await reveal.count();
  for (let i = 0; i < n; i++) {
    await reveal.nth(i).click();
    await page.waitForTimeout(400);
    if ((await btn.count()) && (await btn.first().isVisible().catch(() => false))) return true;
  }
  return (await btn.count()) > 0;
}

export async function clickButton(page: Page, name: string): Promise<void> {
  const revealed = await revealButton(page, name);
  // A freshly-revealed droplist button can swallow its own click while the
  // droplist is still animating/re-rendering; let it settle before clicking.
  if (revealed) await page.waitForTimeout(700);
  await page.getByRole('button', { name }).first().click();
}

export async function addBlock(page: Page, name: string, labelText: string): Promise<void> {
  // Block adds are AJAX-driven and occasionally swallow the click; retry until
  // the block label appears in the form.
  for (let attempt = 0; attempt < 3; attempt++) {
    await clickButton(page, name);
    try {
      await expectBlockLabel(page, labelText);
      return;
    } catch {
      await page.waitForTimeout(1200);
    }
  }
  await expectBlockLabel(page, labelText);
}

export async function addSection(page: Page, columns: string): Promise<void> {
  await clickButton(page, `Add ${columns} Section`);
  await page.waitForTimeout(1800);
}

export async function openAdvancedOptions(page: Page): Promise<void> {
  await page.locator('.paragraph-type-label').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  for (let i = 0; i < 8; i++) {
    const unselected = page.locator('[role="tab"]:not([aria-selected="true"])').filter({ hasText: 'Advanced Options' });
    if ((await unselected.count()) === 0) break;
    await unselected.first().click().catch(() => {});
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(400);
}

export async function expectBlockLabel(page: Page, text: string): Promise<void> {
  await expect(page.locator('.paragraph-type-label').filter({ hasText: text }).first()).toBeVisible({ timeout: 15000 });
}

export async function revealAllActions(page: Page): Promise<void> {
  const reveals = page.getByRole('button', { name: 'List additional actions' });
  const n = await reveals.count();
  for (let i = 0; i < n; i++) {
    if (await reveals.nth(i).isVisible().catch(() => false)) {
      await reveals.nth(i).click();
      await page.waitForTimeout(400);
    }
  }
}

// Publish the current node and return its node id. Drupal redirects to the URL
// alias (e.g. /my-page), not /node/N, so the id is read from the Edit tab link.
export async function publishPage(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Publish Page' }).first().click();
  await page.waitForURL(
    (u) => !u.pathname.includes('/node/add/') && !u.pathname.includes('/edit'),
    { timeout: 30000 }
  );
  const href = await page
    .locator('a[href^="/node/"][href*="/edit"]')
    .first()
    .getAttribute('href')
    .catch(() => '');
  const m = (href || '').match(/\/node\/(\d+)/);
  return m ? m[1] : '';
}

export async function addTextBlock(
  page: Page,
  sectionIndex: number,
  text: string,
  buttonIndex = 0
): Promise<void> {
  // 'Add Text Area Block' buttons are rendered inside each container's droplist
  // and only exist in the DOM while that droplist is open; opening one section's
  // list closes another's. Target the section (and column) directly, opening its
  // nested "List additional actions" only if the block button isn't visible yet.
  const section = page
    .locator(
      'tr.paragraph-type--mod-one-column-section, tr.paragraph-type--mod-two-column-section'
    )
    .nth(sectionIndex);
  const btn = section.getByRole('button', { name: 'Add Text Area Block', exact: true }).nth(buttonIndex);
  if (!(await btn.count()) || !(await btn.first().isVisible().catch(() => false))) {
    await section.getByRole('button', { name: 'List additional actions' }).first().click();
    await page.waitForTimeout(700);
  }
  const before = await page.locator('.ck-editor__editable').count();
  await btn.first().click();
  await page
    .waitForFunction(
      (prev) => document.querySelectorAll('.ck-editor__editable').length > prev,
      before,
      { timeout: 15000 }
    )
    .catch(() => {});
  await page.waitForTimeout(1500);
  await page.locator('.ck-editor__editable').last().fill(text);
}

export async function removeBlock(page: Page, rowSelector: string, label: string): Promise<void> {
  const row = page.locator(rowSelector).filter({ hasText: label }).first();
  const toggle = row.getByRole('button', { name: 'Toggle Actions' }).first();
  const remove = row.getByRole('button', { name: 'Remove', exact: true }).first();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await toggle.count() === 0) break;
    await toggle.click({ timeout: 10000 }).catch(() => {});
    try {
      await remove.click({ timeout: 5000 });
      await page.waitForTimeout(1500);
      return;
    } catch {
      await page.waitForTimeout(300);
    }
  }
  throw new Error('removeBlock failed: could not remove ' + label);
}

export async function toggleBlockAction(page: Page, text: string, action: string): Promise<void> {
  const row = page.locator('tr.paragraph-type--mod-text-area').filter({ hasText: text });
  await row.getByRole('button', { name: 'Toggle Actions' }).first().click();
  await page.waitForTimeout(600);
  await row.getByRole('button', { name: action, exact: true }).first().click();
  await page.waitForTimeout(1500);
}

export async function removeSectionContaining(page: Page, text: string): Promise<void> {
  const row = page
    .locator('tr.paragraph-type--mod-one-column-section, tr.paragraph-type--mod-two-column-section')
    .filter({ hasText: text });
  await row.getByRole('button', { name: 'Toggle Actions' }).first().click();
  await page.waitForTimeout(600);
  await row.getByRole('button', { name: 'Remove', exact: true }).first().click();
  await page.waitForTimeout(1500);
}
