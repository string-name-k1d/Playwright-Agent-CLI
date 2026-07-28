/**
 * Generates a prompt for the AI explorer to identify testable user flows from a snapshot.
 * @param snapshotContent - Playwright accessibility snapshot content
 * @returns Formatted prompt string for the AI
 */
export function explorerPrompt(snapshotContent: string): string {
  return `You are a Playwright test explorer. Analyze the following accessibility snapshot of a web page and identify all testable user flows.

For each flow, provide:
1. A short name (kebab-case, e.g. "add-item-to-cart")
2. A one-line description
3. The element refs (e.g. e5, e10) involved in the flow
4. The sequence of actions (click, fill, select, etc.)
5. Expected outcome

Focus on:
- Form submissions
- Navigation links
- Interactive elements (buttons, checkboxes, dropdowns)
- Key user journeys (login, search, checkout, etc.)

SNAPSHOT:
${snapshotContent}

Respond in markdown format with a numbered list of testable flows.`;
}

/**
 * Generates a prompt for the AI planner to create a structured test plan.
 *
 * @param snapshotContent - Playwright accessibility snapshot of the page
 * @param context - Additional context (element maps, multi-page snapshots, site structure)
 * @param requirements - User-provided requirements or targets to test
 * @param referenceContent - User-provided test procedures and screenshots (from --reference flag)
 * @returns Formatted prompt string for the AI planner
 */
export function plannerPrompt(
  snapshotContent: string,
  context?: string,
  requirements?: string,
  referenceContent?: string
): string {
  const contextSection = context
    ? `\n\nADDITIONAL CONTEXT (element maps, multi-page snapshots, site structure):\n${context}`
    : '';
  const requirementsSection = requirements
    ? `\n\nREQUIREMENTS / TARGETS TO TEST:\n${requirements}\n\nFocus your test plan on the above requirements. Cover each requirement with at least one test case.`
    : '';
  const referenceSection = referenceContent
    ? `\n\n${referenceContent}\n\nIMPORTANT: Use the user-provided test procedures above as the primary source for test steps and expected behavior.`
    : '';

  return `You are a Playwright test planner. Given accessibility snapshots of web page(s), create a structured test plan.

OUTPUT RULES:
- Do NOT include any preamble, introduction, or conversational text before the plan.
- Do NOT write "I'll analyze..." or "Let me first..." or "Here is the plan..." — jump straight into the structured plan.
- The VERY FIRST line of your response must be a markdown heading (## Objective, ## Test Plan, ## Summary, etc.).
- Every response must contain markdown headings, test case descriptions, and code blocks with Playwright snippets.

The test plan should include:
1. Page title and URL
2. Summary of page functionality
3. Individual test cases with:
   - Test name
   - Precondition labels (e.g. [depends: test-name], [requires: setup-name])
   - Steps (describe the element and action, e.g. "Click the 'Home' link in the breadcrumb")
   - Expected results
   - Priority (high/medium/low)

DEPENDENCY RULES:
- If a test requires another test to run first (e.g. CRUD operations: Create before Read/Update/Delete), add a [depends: test-name] label
- If a test requires page setup (e.g. navigating to a specific URL, having an element visible), add [requires: setup-name]
- Group related tests together so dependencies are clear
- Mark tests that can run independently as [standalone]
- Example: "Create Page [depends: none]" → "View Page [depends: create-page]" → "Update Page [depends: create-page]" → "Delete Page [depends: create-page]"

IMPORTANT:
- Element refs like [ref=e12] are ONLY for your reference when reading the snapshot. Do NOT use them as locators in test code.
- In test code, use getByRole(), getByText(), getByTestId() with { exact: true } or .first() to avoid matching multiple elements.
- When multiple page snapshots are provided, plan tests that span those pages
- Use the ELEMENT MAP summary to find the right locators (links, buttons, inputs, headings)
- Prefer getByRole() over getByText() for elements with semantic roles (link, button, heading, table)
- Include locator hints in your test steps (e.g. "Use getByRole('link', { name: 'Home', exact: true })")
- Every code block MUST start with a page.goto() call to navigate to the page

SNAPSHOT ROLE → LOCATOR MAPPING (snapshot uses Playwright accessibility tree — roles map directly):
- "navigation Tabs" → getByRole('navigation', { name: 'Tabs' }) — NOT tablist
- "navigation Toolbar items" → getByRole('navigation', { name: 'Toolbar items' }) — NOT toolbar
- "columnheader" with sort link "Updated Sort ascending" → getByRole('columnheader', { name: /Updated/ }) — use regex, NOT exact: true with just "Updated"
- "option" elements → NEVER plan toBeVisible() assertions on options. Use toHaveValue() or toHaveText() instead
- "link X" where "Edit X" also exists → plan to use getByRole('link', { name: 'X', exact: true })
- "generic" with text "Contents -" → use getByText('Contents') — the dash is formatting, not content

URL RULES:
- For testing URL changes, reference the ACTUAL URL from the snapshot's /url: entries (e.g. /url: "?order=title&sort=asc")
- Do NOT guess URL patterns — read them from the snapshot

SNAPSHOT:
${snapshotContent}
${contextSection}
${requirementsSection}
${referenceSection}

Respond in markdown with a structured test plan. Use proper markdown headings and code blocks for Playwright code snippets.`;
}

/**
 * Generates a prompt for the AI to generate Playwright test code from a plan.
 *
 * @param planContent - The test plan content (markdown with test cases)
 * @param context - Additional context (e.g., target URL)
 * @param referenceContent - User-provided test procedures and screenshots (from --reference flag)
 * @returns Formatted prompt string for the AI generator
 */
export function generatorPrompt(
  planContent: string,
  context?: string,
  referenceContent?: string
): string {
  const contextSection = context ? `\n\nADDITIONAL CONTEXT:\n${context}` : '';
  const referenceSection = referenceContent
    ? `\n\n${referenceContent}\n\nIMPORTANT: Use the user-provided test procedures above as the primary source for test steps, expected behavior, and assertions.`
    : '';

  return `OUTPUT ONLY THE CODE. No explanations, no thinking, no markdown fences, no commentary. Just the raw TypeScript code starting with import.

You are a Playwright test generator. Given a test plan, generate a complete Playwright test file in TypeScript.

CRITICAL LOCATOR RULES (avoid common failures):
- NEVER use [ref=...] or [aria-ref=...] attributes — these are from accessibility snapshots, not real DOM attributes. Use getByRole(), getByText(), getByTestId(), or CSS selectors instead.
- NEVER use .locator('..') to find parent elements — it is fragile and often matches too many elements. Instead, use getByRole() or getByText() with filters.
- When a locator might match multiple elements, ALWAYS narrow it:
  - Use { exact: true } for getByRole/getByText name matching
  - Use .first() or .nth() to pick a specific match
  - Chain locators: parent.getByRole('button', { name: 'Submit' })
  - Use .filter({ hasText: '...' }) to narrow by content
- Prefer getByRole() over getByText() when the element has a semantic role (link, button, heading, etc.)

SNAPSHOT ROLE → PLAYWRIGHT ROLE MAPPING (the snapshot uses Playwright accessibility tree roles — they map DIRECTLY):
- "navigation" → getByRole('navigation', { name: '...' }) — the accessible name is in quotes after the role. "navigation Tabs" means getByRole('navigation', { name: 'Tabs' }). Do NOT use getByRole('tablist') — Drupal uses navigation elements, not tablists.
- "button" → getByRole('button', { name: '...' })
- "link" → getByRole('link', { name: '...' })
- "heading" → getByRole('heading', { name: '...' }) or getByRole('heading', { level: N })
- "table" → getByRole('table')
- "columnheader" → getByRole('columnheader', { name: ... }) — BUT column headers with sort links may have text like "Updated Sort ascending". Use regex: getByRole('columnheader', { name: /Updated/ }). Do NOT use exact: true with just "Updated".
- "cell" → getByRole('cell', { name: '...' })
- "checkbox" → getByRole('checkbox', { name: '...' })
- "combobox" / "listbox" → getByRole('combobox', { name: '...' })
- "option" inside combobox → NEVER use toBeVisible(). Options are hidden by the browser. Use: await expect(select).toHaveValue('value') or await expect(select).toContainText('text')
- "generic" with text like "Contents -" → use getByText('Contents') without exact: true (the dash is formatting)
- "banner" → getByRole('banner')
- "complementary" → getByRole('complementary') — but verify it exists, some sites use navigation instead

STRICT MODE RULES (when a locator matches multiple elements):
- If a table has "Testing Page" as a link AND "Edit Testing Page" as another link, getByRole('link', { name: 'Testing Page' }) matches BOTH. Use getByRole('link', { name: 'Testing Page', exact: true }) or getByRole('link', { name: 'Testing Page' }).first()
- For table rows: scope to the table first: page.getByRole('table').first().getByRole('row').nth(1)

DEPENDENCY HANDLING:
- If the test plan shows [depends: test-name], that test must run AFTER the dependency completes
- If multiple tests share a dependency, extract the setup (e.g. page creation) into a shared beforeAll() hook
- If a test depends on multiple prerequisites, combine their setup in beforeAll()
- For CRUD tests: Create → Read → Update → Delete should be in order with proper setup
- Mark tests that depend on others with test.describe() blocks to group related tests
- Example pattern:
  \`\`\`ts
  test.describe('Page CRUD', () => {
    test.beforeAll(async ({ browser }) => {
      // Setup: create page (depends on none)
    });
    test('View page', async () => { ... }); // depends on create
    test('Update page', async () => { ... }); // depends on create
    test('Delete page', async () => { ... }); // depends on create, update
  });
  \`\`\`

URL/NAVIGATION RULES:
- Every test MUST start with await page.goto() to navigate to the page before any assertions
- For relative URLs in page.goto(), use the path from /url: (e.g. /admin/content, /node/add/page)
- For testing URL changes after clicks, read the actual URL from the snapshot's /url: entries. Example: snapshot shows /url: "?order=title&sort=asc" — use toHaveURL(/order=title/) NOT /sort=title/
- When the snapshot shows a link with a relative URL like /user/login, use page.goto('/user/login')

GENERAL RULES:
- Import from @playwright/test
- Use describe blocks for grouping related tests
- Use modern locators: getByRole(), getByText(), getByTestId()
- Add proper async/await for all async operations
- Include assertions for every test step
- Use RELATIVE paths with page.goto() — e.g. page.goto('/node/add/page'). Do NOT define a BASE_URL constant. Playwright's baseURL from playwright.config.ts automatically prefixes relative paths.
- Add a test.afterEach hook that takes a full-page screenshot on both pass and fail:

\`\`\`ts
test.afterEach(async ({ page }, testInfo) => {
  const { mkdirSync } = await import('node:fs');
  const dir = testInfo.outputDir + '/screenshots';
  try { mkdirSync(dir, { recursive: true }); } catch {}
  const name = testInfo.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const suffix = testInfo.status === 'passed' ? 'pass' : 'fail';
  await page.screenshot({ path: dir + '/' + name + '_' + suffix + '.png', fullPage: true }).catch(() => {});
});
\`\`\`

TEST PLAN:
${planContent}
${contextSection}
${referenceSection}`;
}

/**
 * Generates a prompt for the AI healer to fix a single failing test.
 *
 * @param testCode - The failing test code
 * @param errorOutput - The error output from the test run
 * @param snapshotContent - Optional fresh snapshot of the page at failure time
 * @returns Formatted prompt string for the AI healer
 */
export function healerPrompt(
  testCode: string,
  errorOutput: string,
  snapshotContent?: string
): string {
  const snapshotSection = snapshotContent
    ? `\n\nCURRENT PAGE SNAPSHOT:\n${snapshotContent}`
    : '';

  return `You are a Playwright test healer. A test is failing and needs to be fixed.

Analyze the error and the test code, then provide:
1. Root cause classification: selector_changed | timing_issue | assertion_mismatch | app_bug
2. The specific fix needed
3. The complete corrected test file

If the issue is an app bug (not a test issue), mark the test with test.fixme() and explain what is broken.

FAILING TEST:
${testCode}

ERROR OUTPUT:
${errorOutput}
${snapshotSection}

Respond with:
- ROOT CAUSE: <classification>
- FIX: <description>
- Then the complete corrected .spec.ts file in a code block`;
}

/**
 * Generates a prompt for the AI healer to fix multiple failing tests and generate a corrected plan.
 *
 * @param snapshotContent - Fresh accessibility snapshot of the page after failures
 * @param failureContext - Detailed failure context including errors, test source, and snapshots
 * @returns Formatted prompt string for the AI healer plan
 */
export function healerPlanPrompt(
  snapshotContent: string,
  failureContext: string
): string {
  return `You are a Playwright test healer. Multiple tests are failing against a web page. You have a fresh accessibility snapshot of the page and the failure details.

Your job:
1. Analyze each failure — understand what the test expected vs what the page actually contains
2. Each failure includes: the error message, the FULL test source with line numbers, and the page accessibility snapshot at the exact moment of failure
3. Compare the failing selectors/locators against the FRESH snapshot to find the correct element refs
4. Generate a NEW test plan that:
   - Keeps the same test intent (what each test was trying to verify)
   - Uses correct selectors/locators from the FRESH snapshot
   - Marks tests as test.fixme() if the failure is an app bug (not a test issue)
   - Includes Playwright code snippets for each test case
   - Preserves dependency labels from the original plan ([depends:], [requires:], [standalone])
   - Groups dependent tests in test.describe() blocks with shared beforeAll() setup

For each test failure, explain:
- What went wrong (selector mismatch, missing element, wrong assertion, etc.)
- What the fix is (which element ref or locator to use instead)
- Whether it's a test issue or an app bug
- If the failure is due to a missing dependency (e.g. test ran before its prerequisite), note this and suggest adding proper beforeAll() setup

IMPORTANT: The failure context below contains:
- Error message: the exact Playwright error with locator, expected/actual, and call log
- Failing test source: the complete test file with line numbers (look for the > marker on the failing line)
- Page snapshot at failure time: the accessibility snapshot captured at the exact moment of failure — use this to understand what elements were actually on the page

SNAPSHOT ROLE → LOCATOR MAPPING (snapshot uses Playwright accessibility tree — roles map directly):
- "navigation Tabs" → getByRole('navigation', { name: 'Tabs' }) — NOT tablist
- "navigation Toolbar items" → getByRole('navigation', { name: 'Toolbar items' }) — NOT toolbar
- "columnheader" with sort link "Updated Sort ascending" → getByRole('columnheader', { name: /Updated/ }) — use regex, NOT exact: true with just "Updated"
- "option" elements → NEVER use toBeVisible() on options. Use toHaveValue() or toHaveText() instead
- "link X" where "Edit X" also exists → use getByRole('link', { name: 'X', exact: true })
- For URL assertions, read the actual URL from the snapshot's /url: entries (e.g. /url: "?order=title&sort=asc") — do NOT guess URL patterns

FRESH PAGE SNAPSHOT (re-explored after failure):
${snapshotContent}

FAILING TESTS (with error details, test source, and failure-time page snapshot):
${failureContext}

Respond in markdown with a structured healing plan. Use proper markdown headings and code blocks for Playwright code snippets. Include a "Fixed Tests" section with the complete corrected .spec.ts code.`;
}
