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
  await revealButton(page, name);
  await page.getByRole('button', { name }).first().click();
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
