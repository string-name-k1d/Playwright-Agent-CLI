# Autorun Test: Create Standard Page with Content Blocks

**URL:** `http://mtpc_test/node/add/custom_page/mtpc`

**Objective:** Create a Standard Page with a 1-Column Section and add several content blocks inside its Container, then save.

**Step-by-step instructions (follow these exactly):**

**Step 1:** Navigate to `http://mtpc_test/node/add/custom_page/mtpc`

**Step 2:** Fill the Page Title field:
```ts
await page.getByRole('textbox', { name: 'Page Title' }).fill(`Autorun Blocks ${Date.now()}`);
```

**Step 3:** Click the "Add 1-Column Section" button to create a new section:
```ts
await page.getByRole('button', { name: /Add 1-Column Section/ }).click();
```

**Step 4:** Wait for the section wrapper to appear:
```ts
const section = page.locator('[data-drupal-selector="edit-field-mod-sections-0"]');
await section.waitFor({ state: 'visible', timeout: 15000 });
```

**Step 5:** Fill Section Name inside the section:
```ts
await section.getByRole('textbox', { name: 'Section Name' }).fill('Main Section');
```

**Step 6:** Click "List additional actions" to reveal block buttons:
```ts
await section.getByRole('button', { name: /List additional actions/ }).click();
```

**Step 7:** Add Text Area Block:
```ts
await section.getByRole('button', { name: 'Add Text Area Block' }).click();
```

**Step 8:** Fill the Text Area content (CKEditor 5 contenteditable div):
```ts
await section.locator('[contenteditable="true"]').last().click();
await section.locator('[contenteditable="true"]').last().fill('Welcome to HKUST');
```

**Step 9:** Click "List additional actions" again:
```ts
await section.getByRole('button', { name: /List additional actions/ }).click();
```

**Step 10:** Add Accordion Block:
```ts
await section.getByRole('button', { name: 'Add Accordion Block' }).click();
```

**Step 11:** Fill Accordion Title:
```ts
await section.getByRole('textbox', { name: 'Title' }).fill('Admissions FAQ');
```

**Step 12:** Fill Accordion content (last contenteditable):
```ts
await section.locator('[contenteditable="true"]').last().click();
await section.locator('[contenteditable="true"]').last().fill('See the admissions page');
```

**Step 13:** Click "List additional actions" again:
```ts
await section.getByRole('button', { name: /List additional actions/ }).click();
```

**Step 14:** Add Icon & Text Highlight block:
```ts
await section.getByRole('button', { name: /Add Icon & Text Highlight/ }).click();
```

**Step 15:** Fill Icon & Text Highlight content (last contenteditable):
```ts
await section.locator('[contenteditable="true"]').last().click();
await section.locator('[contenteditable="true"]').last().fill('World-class research across disciplines');
```

**Step 16:** Click Publish Page:
```ts
await page.getByRole('button', { name: /Publish Page/ }).click();
```

**Step 17:** Verify success:
```ts
await expect(page.getByText(/has been created/)).toBeVisible({ timeout: 15000 });
```

**Expected:** Page created with one 1-Column Section containing Text Area, Accordion, and Icon & Text Highlight blocks.

**Important notes:**
- The section does NOT exist on page load — you MUST click "Add 1-Column Section" first
- "List additional actions" must be clicked before EACH block addition
- Rich text content uses CKEditor 5 — fill via `[contenteditable="true"]`, not `getByRole('textbox')`
- The save button is labeled "Publish Page", not "Save"
- No Meta Tags section exists on this form
