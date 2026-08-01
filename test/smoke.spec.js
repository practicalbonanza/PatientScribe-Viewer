import { expect, test } from '@playwright/test';

/**
 * Harness smoke test.
 *
 * This asserts that the harness works, not that the viewer does. It proves a
 * browser starts, the page is served, and the module graph resolves and runs
 * without error — which is the precondition for every behavioural test that
 * follows, and the thing most likely to be silently broken by a renamed file or
 * a bad import path.
 *
 * There are deliberately no assertions about viewer behaviour here. There is no
 * viewer behaviour yet, and a test that asserted some would be asserting an
 * invention.
 */
test('the page is served and its module graph runs without error', async ({ page }) => {
  /** @type {string[]} */
  const consoleErrors = [];
  /** @type {string[]} */
  const pageErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  const response = await page.goto('/index.html');

  expect(response?.status()).toBe(200);
  await expect(page.locator('#viewer-root')).toHaveCount(1);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
