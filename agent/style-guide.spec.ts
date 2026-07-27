import { test, expect } from '@playwright/test';

test.afterEach(async ({ page }, testInfo) => {
  const { mkdirSync } = await import('node:fs');
  const dir = testInfo.outputDir + '/screenshots';
  try { mkdirSync(dir, { recursive: true }); } catch {}
  const name = testInfo.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const suffix = testInfo.status === 'passed' ? 'pass' : 'fail';
  await page.screenshot({ path: dir + '/' + name + '_' + suffix + '.png', fullPage: true }).catch(() => {});
});

test.describe('Style Guide Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('TC-01: Cookie consent banner appears and can be dismissed', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/');

    const cookieHeading = page.getByRole('heading', { name: 'We use cookies on this site to enhance your user experience' });
    await expect(cookieHeading).toBeVisible();

    const agreeButton = page.getByRole('button', { name: 'OK, I agree', exact: true });
    await agreeButton.click();

    await expect(cookieHeading).not.toBeVisible();
  });

  test('TC-02: Breadcrumb navigation contains Home link', async ({ page }) => {
    const breadcrumb = page.getByRole('navigation', { name: /breadcrumb/i });
    await expect(breadcrumb).toBeVisible();

    const breadcrumbHeading = page.getByRole('heading', { name: 'Breadcrumb' });
    await expect(breadcrumbHeading).toBeVisible();

    const homeLink = breadcrumb.getByRole('link', { name: 'Home', exact: true });
    await expect(homeLink).toBeVisible();
    await homeLink.click();
  });

  test('TC-03: All heading levels (H1-H6) are rendered correctly', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'H1 - Lorem Ipsum is light heading', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'H2 - Lorem Ipsum is light heading', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'H3 - Lorem Ipsum is light heading', level: 3 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'H4 - Lorem Ipsum is light heading', level: 4 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'H5 - Lorem Ipsum is light heading', level: 5 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'H6 - Lorem Ipsum is light heading', level: 6 })).toBeVisible();
  });

  test('TC-04: Inline text formatting (bold, italic, highlight, deleted, inserted)', async ({ page }) => {
    await expect(page.locator('mark').first()).toBeVisible();
    await expect(page.locator('strong').first()).toBeVisible();
    await expect(page.locator('em').first()).toBeVisible();
    await expect(page.locator('del').first()).toBeVisible();
    await expect(page.locator('ins').first()).toBeVisible();
  });

  test('TC-05: Blockquote renders with quoted text', async ({ page }) => {
    const blockquoteHeading = page.getByRole('heading', { name: 'Blockquote' });
    await blockquoteHeading.scrollIntoViewIfNeeded();
    await expect(blockquoteHeading).toBeVisible();

    const blockquote = page.locator('blockquote');
    await expect(blockquote.first()).toBeVisible();
    await expect(blockquote.first()).toContainText('Lorem ipsum dolor sit amet');
  });

  test('TC-06: Bordered table displays data with Date, Description, and Author columns', async ({ page }) => {
    const borderedHeading = page.getByRole('heading', { name: 'Bordered Table (tbl-border)' });
    await expect(borderedHeading).toBeVisible();

    const table = borderedHeading.locator('table').first();
    await expect(table).toBeVisible();

    await expect(table.getByRole('columnheader', { name: 'Date' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Description' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Author' })).toBeVisible();

    await expect(table.getByRole('cell', { name: 'May - Apr 2026' })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'Adam KWAN' })).toBeVisible();

    const link = table.getByRole('link', { name: 'May 2028', exact: true });
    await expect(link).toBeVisible();
  });

  test('TC-07: Scroll table renders with headers and linked cell content', async ({ page }) => {
    const scrollHeading = page.getByRole('heading', { name: 'Scroll Table (tbl-scroll)' });
    await expect(scrollHeading).toBeVisible();

    const table = scrollHeading.locator('table').first();
    await expect(table).toBeVisible();

    await expect(table.getByRole('columnheader', { name: 'Date' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Nullam Dictum' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Felis Eupede' })).toBeVisible();

    await expect(table.getByRole('cell', { name: 'Jan - Feb 2025' })).toBeVisible();

    const link = table.getByRole('link', { name: 'Lorem ipsum', exact: true });
    await expect(link).toBeVisible();
  });

  test('TC-08: Line table displays single-column layout with dates and descriptions', async ({ page }) => {
    const lineHeading = page.getByRole('heading', { name: 'Line Table (tbl-line)' });
    await expect(lineHeading).toBeVisible();

    const table = lineHeading.locator('table').first();
    await expect(table).toBeVisible();

    await expect(table.getByRole('columnheader', { name: 'Nullam Dictum Felis Eupede' })).toBeVisible();

    const link = table.getByRole('link', { name: 'Sept 2026', exact: true });
    await expect(link).toBeVisible();
  });

  test('TC-09: Colour table with background styling', async ({ page }) => {
    const colourHeading = page.getByRole('heading', { name: 'Colour Table (tbl-bg)' });
    await expect(colourHeading).toBeVisible();

    const table = colourHeading.locator('table').first();
    await expect(table).toBeVisible();

    await expect(table.getByRole('cell', { name: 'December 2025 - February 2026' })).toBeVisible();

    const link = table.getByRole('link', { name: 'May 2026', exact: true });
    await expect(link).toBeVisible();
  });

  test('TC-10: Borderless table renders without visible borders', async ({ page }) => {
    const borderlessHeading = page.getByRole('heading', { name: 'Borderless Table (tbl-noborder)' });
    await expect(borderlessHeading).toBeVisible();

    const table = borderlessHeading.locator('table').first();
    await expect(table).toBeVisible();

    await expect(table.getByRole('cell', { name: 'May - Apr 2025' })).toBeVisible();

    const link = table.getByRole('link', { name: 'May 2026', exact: true });
    await expect(link).toBeVisible();
  });

  test('TC-11: Read More text links are clickable', async ({ page }) => {
    const textButtonHeading = page.getByRole('heading', { name: 'Text Button' });
    await expect(textButtonHeading).toBeVisible();

    const readMoreLink = page.getByRole('link', { name: 'Read More', exact: true });
    await expect(readMoreLink).toBeVisible();
    await readMoreLink.click();
    await page.goBack();

    const backLink = page.getByRole('link', { name: 'Back' });
    await expect(backLink).toBeVisible();
  });

  test('TC-12: Accordion sections expand and collapse', async ({ page }) => {
    const firstAccordion = page.getByText('Lorem ipsum dolor sit amet consectetuer adipiscing elit');
    await expect(firstAccordion).toBeVisible();
    await firstAccordion.click();

    const expandedContent = page.getByText('Aenean commodo ligula eget dolor');
    await expect(expandedContent).toBeVisible();

    const cumSociisLink = page.getByRole('link', { name: 'Cum sociis natoque' });
    await expect(cumSociisLink).toBeVisible();

    const secondAccordion = page.getByText('Curabitur pretium tincidunt lacus');
    await secondAccordion.click();

    const thirdAccordion = page.getByText('Pellentesque malesuada nulla a min');
    await thirdAccordion.click();
  });

  test('TC-13: Side Menu navigation with nested items', async ({ page }) => {
    const sideMenuHeading = page.getByRole('heading', { name: 'Side Menu' });
    await expect(sideMenuHeading).toBeVisible();

    const testHomeLink = page.getByRole('link', { name: 'Test Home' });
    await expect(testHomeLink).toBeVisible();

    const newsletterLink = page.getByRole('link', { name: 'Newsletter' });
    await expect(newsletterLink).toBeVisible();
    await newsletterLink.click();
  });

  test('TC-14: Right column accordion menu expands/collapses', async ({ page }) => {
    const styleBHeading = page.getByRole('heading', { name: 'Side Menu - Style B' });
    await expect(styleBHeading).toBeVisible();

    const firstItem = page.getByText('Lorem ipsum dolor sit amet consectetuer adipiscing elit').first();
    await firstItem.click();

    const expandedContent = page.getByText('Maecenas laoreet purus');
    await expect(expandedContent).toBeVisible();

    const secondItem = page.getByText('Vepsum dolor sit amet');
    await secondItem.click();

    const thirdItem = page.getByText('Cum sociis natoque nascetur ridiculus mus');
    await thirdItem.click();
  });

  test('TC-15: Unordered and ordered lists render with nested items', async ({ page }) => {
    const unorderedHeading = page.getByRole('heading', { name: 'An Unordered List' });
    await expect(unorderedHeading).toBeVisible();

    await expect(page.getByText('Lorem ipsum dolor sit amet, consectetur adipiscing elit.')).toBeVisible();

    const orderedHeading = page.getByRole('heading', { name: 'An Ordered List' });
    await expect(orderedHeading).toBeVisible();
  });

  test('TC-16: Footer contains links and social media icons', async ({ page }) => {
    const footer = page.getByRole('contentinfo');
    await expect(footer).toBeVisible();

    const backToTop = footer.getByRole('link', { name: 'back to top' });
    await expect(backToTop).toBeVisible();
    await backToTop.click();

    await expect(footer.getByRole('link', { name: 'Privacy' })).toBeVisible();
    await expect(footer.getByRole('link', { name: 'Sitemap' })).toBeVisible();
    await expect(footer.getByRole('link', { name: 'HKUST' })).toBeVisible();

    await expect(footer.getByRole('link', { name: /facebook/i })).toBeVisible();
    await expect(footer.getByRole('link', { name: /instagram/i })).toBeVisible();
    await expect(footer.getByRole('link', { name: /linkedin/i })).toBeVisible();
    await expect(footer.getByRole('link', { name: /youtube/i })).toBeVisible();
  });

  test('TC-17: Skip to main content accessibility link', async ({ page }) => {
    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skipLink).toBeVisible();
    await skipLink.click();
  });

  test('TC-18: Top navigation bar contains expected links', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Test Home' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Login' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Register' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Search' })).toBeVisible();
  });

  test('TC-19: Utility navigation contains HKUST links', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'University News' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Academic Departments A-Z' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Life@HKUST' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Library' })).toBeVisible();
  });

  test('TC-20: Horizontal separator renders between sections', async ({ page }) => {
    const hrHeading = page.getByRole('heading', { name: 'Horizonal Line' });
    await hrHeading.scrollIntoViewIfNeeded();
    await expect(hrHeading).toBeVisible();

    await expect(page.locator('hr').first()).toBeVisible();
  });
});
