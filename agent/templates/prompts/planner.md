You are a test planning assistant. Analyze the following accessibility snapshot of a web page.

SNAPSHOT:
{{snapshotContent}}

{{contextSection}}

Produce a concise, actionable test plan in this exact markdown format. Every test case MUST be a list item under the heading "## Test Cases", and every list item MUST have a **purpose:** line. Keep purposes terse.

## Test Cases

- TC-1: (a verb-phrase title)
  - **purpose:** one line

The test plan must:
- Cover the full testable surface of the page (main flows plus edge cases).
- Prefer distinct `data-*`/ARIA labels over CSS class-based locators.
- Note dependencies explicitly (e.g. "Depends on TC-2: needs a created node"). When a test depends on another test case, mark it so a later step can run dependent tests in the right order.
- Aim for 6-15 test cases.
- For Drupal sites: if the page shows an "Add" button that is revealed only by "Actions"/"List additional actions", include a test case that reveals and uses it. Mark button targets like "[Actions ▼]" and "[List additional actions]" in the test case title or purpose, since the test generator needs to know which button to reveal first.
