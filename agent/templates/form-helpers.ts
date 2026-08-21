import { test, expect, type Page, type Locator } from '@playwright/test';

/**
 * Event-driven settle: poll `ready` until it returns true (or `timeoutMs`
 * elapses), then fall back to a short fixed delay only when the signal never
 * fired. Keeps fast hosts fast while staying safe on slow AJAX re-renders.
 */
async function settleWhen(
  page: Page,
  ready: () => Promise<boolean>,
  timeoutMs = 8000,
  fallbackMs = 700,
  pollMs = 150
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ready().catch(() => false)) return;
    await page.waitForTimeout(pollMs);
  }
  if (fallbackMs > 0) await page.waitForTimeout(fallbackMs);
}

export async function revealButton(page: Page, name: string): Promise<boolean> {
  const btn = page.getByRole('button', { name });
  const visible = async (): Promise<boolean> =>
    (await btn.count()) > 0 && (await btn.first().isVisible().catch(() => false));
  if (await visible()) return true;
  const reveal = page.getByRole('button', { name: 'List additional actions' });
  const n = await reveal.count();
  for (let i = 0; i < n; i++) {
    await reveal.nth(i).click();
    // Event-driven: the target button appears as soon as its droplist opens.
    await settleWhen(page, visible, 3000, 400);
    if (await visible()) return true;
  }
  return (await btn.count()) > 0;
}

export async function clickButton(page: Page, name: string): Promise<void> {
  const revealed = await revealButton(page, name);
  const btn = page.getByRole('button', { name }).first();
  if (!revealed) {
    await btn.click();
    return;
  }
  // A freshly-revealed droplist can swallow its own click while still
  // animating/re-rendering. Wait for the button's position to stabilise
  // (two identical bounding boxes) before clicking; fall back to a short
  // settle when stability can't be confirmed.
  const stable = async (): Promise<boolean> => {
    const a = await btn.boundingBox().catch(() => null);
    if (!a) return false;
    await page.waitForTimeout(150);
    const b = await btn.boundingBox().catch(() => null);
    return !!b && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
  };
  await settleWhen(page, stable, 2000, 700);
  await btn.click();
}

export async function addBlock(page: Page, name: string, labelText?: string): Promise<void> {
  // Block adds are AJAX-driven and occasionally swallow the click; retry until
  // the block label appears in the form.
  for (let attempt = 0; attempt < 3; attempt++) {
    await clickButton(page, name);
    if (!labelText) {
      // Event-driven: any paragraph label rendering signals the add landed.
      await settleWhen(
        page,
        async () => (await page.locator('.paragraph-type-label').count()) > 0,
        6000,
        2000
      );
      return;
    }
    try {
      await expectBlockLabel(page, labelText);
      return;
    } catch {
      await page.waitForTimeout(1200);
    }
  }
  if (labelText) await expectBlockLabel(page, labelText);
}

export async function addSection(page: Page, columns: string): Promise<void> {
  const before = await page.locator('.paragraph-type-label').count();
  await clickButton(page, `Add ${columns} Section`);
  // Event-driven: the section's label rendering grows the label count.
  await settleWhen(
    page,
    async () => (await page.locator('.paragraph-type-label').count()) > before,
    10000,
    1800
  );
}

export async function openAdvancedOptions(page: Page): Promise<void> {
  await page.locator('.paragraph-type-label').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  for (let i = 0; i < 8; i++) {
    const unselected = page.locator('[role="tab"]:not([aria-selected="true"])').filter({ hasText: 'Advanced Options' });
    if ((await unselected.count()) === 0) break;
    const tab = unselected.first();
    await tab.click().catch(() => {});
    // Event-driven: wait until this tab reports aria-selected="true". The DOM
    // may re-render and detach the locator mid-poll — that reads as "not yet".
    await settleWhen(
      page,
      async () => (await tab.getAttribute('aria-selected').catch(() => null)) === 'true',
      4000,
      600
    );
  }
}

export async function expectBlockLabel(page: Page, text: string): Promise<void> {
  await expect(page.locator('.paragraph-type-label').filter({ hasText: text }).first()).toBeVisible({ timeout: 15000 });
}

export async function revealAllActions(page: Page): Promise<void> {
  const reveals = page.getByRole('button', { name: 'List additional actions' });
  const n = await reveals.count();
  for (let i = 0; i < n; i++) {
    const r = reveals.nth(i);
    if (await r.isVisible().catch(() => false)) {
      await r.click();
      // Event-driven: Drupal dropbuttons toggle aria-expanded when opened.
      await settleWhen(
        page,
        async () => (await r.getAttribute('aria-expanded').catch(() => null)) === 'true',
        2000,
        400
      );
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
    // Event-driven: the revealed block button becoming visible.
    await settleWhen(page, async () => btn.first().isVisible().catch(() => false), 4000, 700);
  }
  const before = await page.locator('.ck-editor__editable').count();
  await btn.first().click();
  // Event-driven: a new CKEditor instance mounting signals the add landed.
  try {
    await page.waitForFunction(
      (prev) => document.querySelectorAll('.ck-editor__editable').length > prev,
      before,
      { timeout: 15000 }
    );
  } catch {}
  const editor = page.locator('.ck-editor__editable').last();
  // fill() auto-waits for editability; this settle just guards early detach.
  await settleWhen(page, async () => editor.isVisible().catch(() => false), 3000, 1500);
  await editor.fill(text);
}

export async function removeBlock(page: Page, rowSelector: string, label: string): Promise<void> {
  const row = page.locator(rowSelector).filter({ hasText: label }).first();
  const toggle = row.getByRole('button', { name: 'Toggle Actions' }).first();
  const remove = row.getByRole('button', { name: 'Remove', exact: true }).first();
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await toggle.count()) === 0) break;
    await toggle.click({ timeout: 10000 }).catch(() => {});
    try {
      await remove.click({ timeout: 5000 });
      // Event-driven: the row detaching/hiding confirms removal.
      await settleWhen(page, async () => !(await row.isVisible().catch(() => false)), 8000, 1500);
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
  const actionBtn = row.getByRole('button', { name: action, exact: true }).first();
  // Event-driven: the action button appears once the actions list opens.
  await settleWhen(page, async () => actionBtn.isVisible().catch(() => false), 4000, 600);
  await actionBtn.click();
  // Event-driven: the droplist closing signals the action was dispatched.
  await settleWhen(page, async () => !(await actionBtn.isVisible().catch(() => false)), 6000, 1500);
}

export async function removeSectionContaining(page: Page, text: string): Promise<void> {
  const row = page
    .locator('tr.paragraph-type--mod-one-column-section, tr.paragraph-type--mod-two-column-section')
    .filter({ hasText: text });
  await row.getByRole('button', { name: 'Toggle Actions' }).first().click();
  const remove = row.getByRole('button', { name: 'Remove', exact: true }).first();
  // Event-driven: Remove appears once the actions list opens.
  await settleWhen(page, async () => remove.isVisible().catch(() => false), 4000, 600);
  await remove.click();
  // Event-driven: the row disappearing confirms removal.
  await settleWhen(page, async () => !(await row.isVisible().catch(() => false)), 8000, 1500);
}

// ── Locator fallback cascade ────────────────────────────────────────
// Deterministic local recovery for broken locators: progressively looser
// strategies BEFORE failing (and before any expensive healing pass).

/**
 * Finds a button by accessible name using a 3-strategy fallback cascade:
 * role+name exact → role+name substring → visible text. Throws only when
 * every strategy fails.
 */
export async function findButton(page: Page, name: string): Promise<Locator> {
  const strategies: Locator[] = [
    page.getByRole('button', { name, exact: true }),
    page.getByRole('button', { name }),
    page.getByText(name, { exact: true }),
  ];
  for (const loc of strategies) {
    const candidate = loc.first();
    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
      return candidate;
    }
  }
  throw new Error(`findButton: no visible match for "${name}" (tried role-exact, role-substring, text)`);
}

/**
 * Fills a field by label using a 3-strategy fallback cascade:
 * label exact → label substring → textbox/combobox role with that name.
 * Throws only when every strategy fails.
 */
export async function fillField(page: Page, name: string, value: string): Promise<void> {
  const strategies: Locator[] = [
    page.getByLabel(name, { exact: true }),
    page.getByLabel(name),
    page.getByRole('textbox', { name }).or(page.getByRole('combobox', { name })),
  ];
  for (const loc of strategies) {
    const candidate = loc.first();
    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
      await candidate.fill(value);
      return;
    }
  }
  throw new Error(`fillField: no visible field for "${name}" (tried label-exact, label-substring, role)`);
}
