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

When the snapshot shows buttons like "List additional actions", "Toggle Actions", "Expand", or "Advanced Options", flag them explicitly: they hide further actions/fields that the flows may need to click first. Do not assume every add button is visible in the initial snapshot.

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
  const requirementsSection = requirements
    ? `\n\n## Requirements / Targets to Test (MANDATORY — COVER EVERY ITEM)\n${requirements}\n\nYour test plan MUST cover every requirement above. Map each requirement to at least one test case (TC-N).\n- If a requirement needs a page NOT in the snapshots below, add it to "## Pages to Explore" so the system explores it — do NOT skip or guess.\n- Prefer concrete, executable requirements over generic ones.`
    : '';
  const referenceSection = referenceContent
    ? `\n\n## User-Provided Reference Procedures (primary source for steps)\n${referenceContent}\n\nIMPORTANT: Use the user-provided test procedures above as the primary source for test steps and expected behavior.`
    : '';
  const contextSection = context
    ? `\n\nADDITIONAL CONTEXT (element maps, multi-page snapshots, site structure):\n${context}`
    : '';

  return `You are a Playwright test planner. Given accessibility snapshots of web page(s), create a structured test plan.
${requirementsSection}
${referenceSection}

You MUST follow the EXACT format below with no variations. Every plan must start with ## Objective as the first line.

## Required Format

\`\`\`
## Objective
<Single paragraph describing the overall goal of this test plan — what pages are tested and what user flows are covered.>

## Pages
- <URL> — <description of the page's role in the plan>
- <URL> — <description>

## Test Cases

### TC-1: <kebab-case-test-name>
- **Priority:** high|medium|low
- **Dependencies:** standalone | depends: TC-NAME | requires: <description>
- **Description:** <one-line description of what this test verifies>
- **Steps:**
  1. <action — describe element and action, include locator hint>
  2. <action>
- **Expected:** <what should happen after the steps>

### TC-2: <kebab-case-test-name>
- **Priority:** high|medium|low
- **Dependencies:** standalone | depends: TC-1 | requires: <description>
- **Description:** <...>
- **Steps:**
  1. <...>
- **Expected:** <...>
\`\`\`

## Format Rules

OUTPUT RULES:
- Do NOT include any preamble, introduction, or conversational text before the plan.
- Do NOT write "I'll analyze..." or "Let me first..." or "Here is the plan..." — jump straight into the structured plan.
- The VERY FIRST line of your response MUST be: ## Objective
- Every test case must have exactly one Priority, Dependencies, Description, Steps, and Expected field.
- Use the exact field names: **Priority:**, **Dependencies:**, **Description:**, **Steps:**, **Expected:**
- Number the test cases TC-1, TC-2, TC-3, etc.
- Use kebab-case for test names (e.g. "create-basic-page", "edit-existing-page").
- Prefix URLs with / for same-origin paths.

EXPLORATION ANNOTATIONS:
- If a test case requires visiting a page that has NOT been provided as a snapshot above, add a "## Pages to Explore" section at the end of your plan listing each URL:
  ## Pages to Explore
  - [explore: /admin/content] — Content listing for "Edit Content" test
  - [explore: /node/add/page] — Add page form for "Create Page" test
- The system will automatically open each URL, capture its accessibility snapshot, and re-invoke you with the expanded context.
- Do NOT guess element refs or page structure for un-explored pages. Instead, list them for exploration.
- Use [explore: URL] for:
  - Pages reachable via links in the current snapshot that form part of a test flow
  - Form submission targets (after creating content, where does the user land?)
  - Admin pages needed for test setup (login, content admin, etc.)
  - A page.goto() target in any test case that does not already have a snapshot provided
- If a test case's steps need components that are hidden behind droplists, reveal buttons, or collapsed tabs — e.g. "List additional actions", "Toggle Actions", "Advanced Options", dropbutton secondary actions like "Add <Block>" options — those components are NOT in the DOM (and NOT in the snapshot) until the control is opened. Request an INTERACTIVE re-exploration of that page so the system clicks the reveals and captures the hidden components:
  - [explore-expanded: /node/add/page] — Re-explore this page by opening its droplists/tabs to capture hidden section/block add buttons and configuration fields

DEPENDENCY RULES:
- If a test requires another test to run first (e.g. CRUD operations: Create before Read/Update/Delete), add a [depends: test-name] label
- If a test requires page setup (e.g. navigating to a specific URL, having an element visible), add [requires: setup-name]
- Group related tests together so dependencies are clear
- Mark tests that can run independently as [standalone]
- Example: "standalone" → "depends: create-page" → "depends: create-page" → "depends: create-page"

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

Respond in markdown with a structured test plan. Use proper markdown headings and code blocks for Playwright code snippets.`;
}

/**
 * Generates a prompt for the AI to generate Playwright test code from a plan.
 *
 * @param planContent - The test plan content (markdown with test cases)
 * @param context - Additional context (e.g., target URL)
 * @param referenceContent - User-provided test procedures and screenshots (from --reference flag)
 * @param scopeNote - Optional note describing which subset of the plan this
 *   call must generate (e.g. "Generate ONLY test cases TC-1..TC-10 — batch 1/5
 *   of the full plan"). Keeps each opencode request small so batches stay fast.
 * @returns Formatted prompt string for the AI generator
 */
export function generatorPrompt(
  planContent: string,
  context?: string,
  referenceContent?: string,
  scopeNote?: string
): string {
  const contextSection = context ? `\n\nADDITIONAL CONTEXT:\n${context}` : '';
  const referenceSection = referenceContent
    ? `\n\n${referenceContent}\n\nIMPORTANT: Use the user-provided test procedures above as the primary source for test steps, expected behavior, and assertions.`
    : '';
  const scopeSection = scopeNote ? `\n\nSCOPE:\n${scopeNote}\n` : '';

  return `OUTPUT ONLY THE CODE. No explanations, no thinking, no markdown fences, no commentary. Just the raw TypeScript code starting with import.

You are a Playwright test generator. Given a test plan, generate a complete Playwright test file in TypeScript.

CRITICAL LOCATOR RULES (avoid common failures):
- NEVER use [ref=...] or [aria-ref=...] attributes — these are from accessibility snapshots, not real DOM attributes. Use getByRole(), getByText(), getByTestId(), or CSS selectors instead. (When codegen-recorded scripts are included as references, their [eN] annotations are informational comments only — resolve each to the matching getByRole()/getByText() locator, and when a ref list shows multiple matches for a repeating element, disambiguate with .nth().)
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

DRUPAL/COMPOSER FORM MECHANICS (apply when the plan targets a Drupal content-add/edit form with "sections" and "blocks"):
- getByRole() name matching is SUBSTRING + case-insensitive by default. A button named "Add Slide" also matches "Add Slideshow Block" and "Add Slideshow Item to Slideshow Item" — which one .first() hits depends on DOM order, so prefer unambiguous full names with { exact: true }, or scope to the container, or verify via a later assertion (e.g. count of rendered labels) that the intended action happened.
- Many add buttons ("Add 1-Column Section", block add buttons) live inside hidden lists behind a reveal button (e.g. "List additional actions"). The hidden buttons may be ABSENT from the DOM until the reveal is clicked: getByRole(...).toHaveCount(0) before reveal, 1+ after. Click every reveal button (they are re-created/toggled as lists open) until the target is visible, then click it. Writing this as a local helper (reveal-and-click) keeps tests readable.
- Paragraph widgets render each added item with a label span (e.g. '.paragraph-type-label'). Asserting that label's text (filter by /Text/i) is the reliable "was added" signal — not URLs, comboboxes, or field labels that often don't exist. Sub-paragraphs (e.g. a slideshow's slide) may label their fields differently than you expect ("Caption" often becomes "Slide Text Line 1" or similar) — read the snapshot's visible labels before filling.
- jQuery-UI-style "Advanced Options" tabs: fields under a tab are NOT in the DOM until that tab is opened. Opening one tab can re-render the DOM and detach other tabs, so re-query tabs after each click and open until no unselected Advanced Options tab remains (check aria-selected). Wait for the section to render (its label span) BEFORE opening tabs, otherwise only the form-level tab exists.
- Always wait for an ajax-added element to finish rendering before clicking into it or adding more (e.g. wait for the first paragraph-type-label to be visible). A fixed 1.5–2s settle wait after an add is usually required; clicking an add-more button too early gets silently swallowed by the re-render.
- <select> options with numeric values: selectOption({ label }) to pick, but assert the selected row with locator('option:checked').toHaveText(...), NOT toHaveValue(numeric).
- Submit buttons may be labeled differently than "Save" (e.g. "Publish Page"). An empty required title keeps the form on the same URL (native validation) — but NOT every blank field is validated; some empty fields publish successfully. Assert the observed behavior rather than assuming validation.
- On slow hosts: multi-step flows (several sequential adds) easily exceed the 30s default test timeout. Add test.setTimeout(120000) to such tests, and raise describe-level timeout with test.describe.configure({ timeout: 120000 }).

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
- NEVER use test.describe.configure({ mode: 'serial' }) or test.describe.serial() — a failing test must NOT skip the remaining tests in the file. Dependent tests are still run in order (definition order), and the runner schedules cross-file dependencies. Every test must always execute so all failures are reported.
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
${referenceSection}
${scopeSection}`;
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
  failureContext: string,
  originalPlan?: string
): string {
  const originalPlanSection = originalPlan
    ? `\nORIGINAL TEST PLAN (ALL test cases — passing and failing):
${originalPlan}
`
    : '';

  return `You are a Playwright test healer. Multiple tests are failing against a web page. You have a fresh accessibility snapshot of the page and the failure details.

You MUST produce a healing plan in the SAME standardized format as the original plan. The format is:

\`\`\`
## Objective
<Brief description of the healing plan — what was failing and what was fixed.>

## Pages
- <URL> — <description>

## Test Cases

### TC-1: <kebab-case-test-name>
- **Priority:** high|medium|low
- **Dependencies:** standalone | depends: TC-NAME | requires: <description>
- **Description:** <one-line description>
- **Steps:**
  1. <action with locator>
- **Expected:** <expected outcome>
\`\`\`

Your job:
1. Analyze each failure — understand what the test expected vs what the page actually contains
2. Each failure includes: the error message, the FULL test source with line numbers, and the page accessibility snapshot at the exact moment of failure
3. Compare the failing selectors/locators against the FRESH snapshot to find the correct element refs
4. Generate a NEW test plan that:
   - KEEPS every test case from the original plan that is NOT listed as failing below — those tests PASSED and must be preserved EXACTLY as-is (same test name, priority, dependencies, description, steps, expected results, and code snippet). Do NOT rewrite, renumber, or reorder them.
   - Fixes ONLY the failing tests listed below (keep the same test intent, correct the selectors/assertions)
   - Uses correct selectors/locators from the FRESH snapshot
   - Marks tests as test.fixme() if the failure is an app bug (not a test issue)
   - Includes Playwright code snippets for each test case
   - Preserves dependency labels from the original plan ([depends:], [requires:], [standalone])
   - Groups dependent tests in test.describe() blocks with shared beforeAll() setup
   - If the fix requires visiting a new URL not yet in the snapshots above, add: [re-explore: URL] in the plan section
   - Follows the exact format: ## Objective, ## Pages, ## Test Cases, ### TC-N: <name> with bold field labels
   - CRITICAL: Your healing plan MUST include EVERY test case from the original plan (preserved passing tests AND fixed failing tests) — never drop a passing test case

RE-EXPLORATION ANNOTATIONS:
- If a test fails because the page was not explored (missing snapshot), or the failure involves navigating to a different URL that wasn't captured, add a "## Pages to Re-Explore" section:
  ## Pages to Re-Explore
  - [re-explore: /admin/content] — Fresh snapshot needed for content page
- The system will re-explore each URL and re-invoke you with fresh snapshots.
- Use [re-explore: URL] when the error suggests:
  - An element exists on a different page than the one in the snapshot
  - The page structure changed significantly (navigation, layout shift)
  - A previous page.goto() target wasn't included in the exploration

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
${originalPlanSection}
Respond in markdown with a structured healing plan. Use proper markdown headings and code blocks for Playwright code snippets. Include a "Fixed Tests" section with the complete corrected .spec.ts code for ALL test cases (preserved passing tests AND fixed failing tests) — the complete file, not just the failing tests. Do NOT use test.describe.configure({ mode: 'serial' }) or test.describe.serial() in the code — every test must always execute so all failures are reported.`;
}
