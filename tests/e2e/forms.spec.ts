import { test, expect } from '@playwright/test';

test.describe('Contact form', () => {
  test('submits required fields and shows thank-you alert', async ({ page }) => {
    await page.goto('/contact');
    await page.locator('#contact-form #firstName').fill('Playwright');
    await page.locator('#contact-form #lastName').fill('Test');
    await page.locator('#contact-form #email').fill('pw-test@example.com');
    await page.locator('#contact-form #message').fill('E2E test message.');

    const dialogPromise = page.waitForEvent('dialog').then((dialog) => {
      expect(dialog.message()).toContain('Thank you');
      return dialog.accept();
    });
    await page.locator('#contact-form button[type="submit"]').click();
    await dialogPromise;

    await expect(page.locator('#contact-form #firstName')).toHaveValue('');
  });
});

test.describe('Order form (inquiry)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/send-order-email', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, emailId: 'mock' }),
      });
    });
  });

  test('redirects to thank-you after successful inquiry', async ({ page }) => {
    await page.goto('/order-now');
    await page.locator('#premiumLine').fill('2');
    await page.locator('#order-form #firstName').fill('Order');
    await page.locator('#order-form #lastName').fill('Test');
    await page.locator('#order-form #email').fill('order-test@example.com');
    await page.locator('#order-form #phone').fill('7125550199');

    await page.locator('#order-form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/thank-you\?kind=inquiry/);
    await expect(page.getByRole('heading', { name: /Thank you/i })).toBeVisible();
  });
});
