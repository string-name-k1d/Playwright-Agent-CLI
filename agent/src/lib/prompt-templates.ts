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

export function plannerPrompt(
  snapshotContent: string,
  context?: string,
  requirements?: string
): string {
  const contextSection = context
    ? `\n\nADDITIONAL CONTEXT (element maps, multi-page snapshots, site structure):\n${context}`
    : '';
  const requirementsSection = requirements
    ? `\n\nREQUIREMENTS / TARGETS TO TEST:\n${requirements}\n\nFocus your test plan on the above requirements. Cover each requirement with at least one test case.`
    : '';

  return `You are a Playwright test planner. Given accessibility snapshots of web page(s), create a structured test plan.

The test plan should include:
1. Page title and URL
2. Summary of page functionality
3. Individual test cases with:
   - Test name
   - Preconditions
   - Steps (describe the element and action, e.g. "Click the 'Home' link in the breadcrumb")
   - Expected results
   - Priority (high/medium/low)

IMPORTANT:
- Element refs like [ref=e12] are ONLY for your reference when reading the snapshot. Do NOT use them as locators in test code.
- In test code, use getByRole(), getByText(), getByTestId() with { exact: true } or .first() to avoid matching multiple elements.
- When multiple page snapshots are provided, plan tests that span those pages
- Use the ELEMENT MAP summary to find the right locators (links, buttons, inputs, headings)
- Prefer getByRole() over getByText() for elements with semantic roles (link, button, heading, table)
- Include locator hints in your test steps (e.g. "Use getByRole('link', { name: 'Home', exact: true })")

SNAPSHOT:
${snapshotContent}
${contextSection}
${requirementsSection}

Respond in markdown with a structured test plan. Use proper markdown headings and code blocks for Playwright code snippets.`;
}

export function generatorPrompt(
  planContent: string,
  context?: string
): string {
  const contextSection = context ? `\n\nADDITIONAL CONTEXT:\n${context}` : '';

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
- For navigation breadcrumbs, use getByRole('link', { name: 'Home', exact: true }) inside the nav element
- For tables under headings, use heading.getByRole('table').first() or heading.locator('table').first()
- For accordion/collapse content, use getByText() with a unique snippet from the expanded content, NOT ref attributes

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
${contextSection}`;
}

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

export function healerPlanPrompt(
  snapshotContent: string,
  failureContext: string
): string {
  return `You are a Playwright test healer. Multiple tests are failing against a web page. You have a fresh accessibility snapshot of the page and the failure details.

Your job:
1. Analyze each failure — understand what the test expected vs what the page actually contains
2. Compare the failing selectors/locators against the fresh snapshot to find the correct element refs
3. Generate a NEW test plan that:
   - Keeps the same test intent (what each test was trying to verify)
   - Uses correct selectors/locators from the FRESH snapshot
   - Marks tests as test.fixme() if the failure is an app bug (not a test issue)
   - Includes Playwright code snippets for each test case

For each test failure, explain:
- What went wrong (selector mismatch, missing element, wrong assertion, etc.)
- What the fix is (which element ref or locator to use instead)
- Whether it's a test issue or an app bug

FRESH PAGE SNAPSHOT:
${snapshotContent}

FAILING TESTS:
${failureContext}

Respond in markdown with a structured healing plan. Use proper markdown headings and code blocks for Playwright code snippets. Include a "Fixed Tests" section with the complete corrected .spec.ts code.`;
}
