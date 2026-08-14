# Large Coverage Autorun: UAT Drupal Platform (callitso.docker-uat01.ust.hk)

**Base URL:** `https://callitso.docker-uat01.ust.hk/`
**Site:** Drupal Platform Demonstration v10.8 (MTPC content model)

Goal: broad functional coverage across the site. Produce a comprehensive,
independent test plan covering every area below. Prefer breadth over depth:
at least one representative case per item, so the whole site's functionality
is exercised in one run.

## Prerequisites / execution context

- Authenticated session is provided via browser storage state (already logged
  in as an admin user with the toolbar visible). HTTP Basic Auth is supplied
  automatically. Do NOT attempt to log in interactively.
- Each test case must be **fully independent**: start with `page.goto()` to the
  form/page it needs, do minimal setup inside the test itself (add the section /
  blocks it needs), never rely on state created by another test.
- Content-submission cases (anything that creates a page) MUST end by clicking
  the **Publish Page** button and asserting the redirect to `/node/<id>` or the
  "has been created" confirmation, so created content is persisted and verifiable.
- Rich text is CKEditor 5 — fill via `[contenteditable="true"]`, not `getByRole('textbox')`.
- The primary submit/save button on the content form is labeled **Publish Page**
  (not "Save"). Sections and block buttons may be hidden behind the
  **List additional actions** button — click it to reveal block buttons.
- The section does NOT exist on page load: you MUST click `Add <N>-Column
  Section` first and wait for its wrapper to appear before adding blocks.

## Coverage areas (in priority order)

### 1. Homepage & site navigation
- Homepage (`/`) loads and shows the site header, main navigation, and footer.
- Main-menu / top links are present and clicking a navigation link navigates to
  a valid page (assert the URL changed and the page body renders, no 404).
- A "Skip to main content" link exists.
- Footer links (e.g. site information, social links) render.

### 2. Authentication & admin toolbar
- `/user/login` is reachable; because the session is authenticated it redirects
  away / shows the toolbar, not the login form.
- The admin toolbar is visible with MTPC Administration, Content shortcuts, and
  a Logout link.

### 3. Content management (`/admin/mtpc/content`)
- The content listing loads with published status shown for each row.
- A "filter" / search input exists and filtering by title narrows the list.
- The "Add content" button is present.
- Pages created by other cases in this run appear in the listing as **Published**.

### 4. Custom page creation — sections & layout options (`/node/add/custom_page/mtpc`)
- Create a page with a **1-Column Section** and a Section Name.
- Create a page with a **2-Column Section**.
- Create a page with a **3-Column Section**.
- Create a page with a **4-Column Section**.
- Advanced Options: toggle **Full Width**, add a CSS class / animation, enable
  **Hide on Mobile / Hide on Tablet / Hide on Desktop**, and **Hide page title**
  / **Hide breadcrumbs** — assert the option toggles are applied.
- Menu settings: enable **Provide a menu link** and pick a menu/parent.

### 5. Custom page creation — content blocks (one case per block type)
Each block is added inside a freshly added section on its own test page:
- **Text Area** — fill CKEditor content, verify text persists in the field.
- **Accordion** — add, set Title, fill content.
- **Image** — add an Image block (use the simplest available media selection).
- **Image Grid** — add an Image Grid block.
- **Icon & Text Highlight** — add and fill the highlight content.
- **Slideshow** — add a Slideshow block.
- **Album** — add an Album block.
- **Video** and **Youtube/Youku** — add each block type.
- **Page Title** block — add.
- **Next & Previous** block — add.
- **Views** block — add a Views block.
- **Navigation Menu** block — add and select a menu (e.g. Main Menu).
- **People / Profile Details / Profile Listing** — add each.
- **News** and **Events Carousel** — add each.
- **3-Column Carousel** — add a 3-Column Carousel block.

For block types with complex media/picker flows, it is acceptable to add the
block, fill any plain text/title fields, and assert the block was added to the
section (its field group/wrapper is present), rather than completing a full
media upload — but the page must still be published at the end.

### 6. Publishing & verification (applies to every content-creation case)
- After filling the form, click **Publish Page**, wait for
  `page.waitForURL(/\/node\/\d+/)` or the "has been created" status, then verify
  the node appears as Published in the content listing (`/admin/mtpc/content`).

## Expected plan shape

- One standalone test case (TC-N) per coverage item above, with an explicit
  Priority (high for sections, blocks, and publishing; medium for options and
  navigation), explicit Steps, and Expected result.
- Indicate Dependencies only where truly required (prefer none).
- Note the base URL for every test is `https://callitso.docker-uat01.ust.hk`.
