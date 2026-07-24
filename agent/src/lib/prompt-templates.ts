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
  const contextSection = context ? `\n\nADDITIONAL CONTEXT:\n${context}` : '';
  const requirementsSection = requirements
    ? `\n\nREQUIREMENTS / TARGETS TO TEST:\n${requirements}\n\nFocus your test plan on the above requirements. Cover each requirement with at least one test case.`
    : '';

  return `You are a Playwright test planner. Given an accessibility snapshot of a web page, create a structured test plan.

The test plan should include:
1. Page title and URL
2. Summary of page functionality
3. Individual test cases with:
   - Test name
   - Preconditions
   - Steps (using element refs from the snapshot)
   - Expected results
   - Priority (high/medium/low)

Use Playwright-compatible assertions where possible (e.g. toHaveURL, toHaveText, toBeVisible).

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

  return `You are a Playwright test generator. Given a test plan, generate a complete Playwright test file in TypeScript.

Requirements:
- Import from @playwright/test
- Use modern locators (getByRole, getByText, getByTestId, etc.)
- Add proper assertions for each test step
- Use describe blocks to group related tests
- Include proper async/await
- Add comments for non-obvious steps
- Use page.goto() for navigation
- Prefer role-based locators over CSS selectors

TEST PLAN:
${planContent}
${contextSection}

Respond with a complete .spec.ts file. Use proper TypeScript and Playwright Test conventions.`;
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
