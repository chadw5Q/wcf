import { test, expect } from '@playwright/test';

test.describe('Hunt API (middleware)', () => {
  test('POST /api/hunt-reserve is not redirected to hunt login', async ({ request }) => {
    const res = await request.post('/api/hunt-reserve', {
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status()).not.toBe(302);
    expect(res.headers()['location'] ?? '').not.toContain('/hunt/login');
  });

  test('POST /api/hunt-balance is not redirected to hunt login', async ({ request }) => {
    const res = await request.post('/api/hunt-balance', {
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status()).not.toBe(302);
    expect(res.headers()['location'] ?? '').not.toContain('/hunt/login');
  });
});

/**
 * Optional: set `HUNT_E2E_PASSWORD` to match `HUNT_PASSWORD` on the dev server
 * (defaults to `HuntIowa2026` in local dev when unset).
 */
test.describe('Hunt subsite login', () => {
  test('login → landing → reserve form visible', async ({ page }) => {
    const huntPassword = process.env.HUNT_E2E_PASSWORD;
    test.skip(!huntPassword, 'Set HUNT_E2E_PASSWORD to match HUNT_PASSWORD for this test.');

    await page.goto('/hunt/login');
    await page.locator('#hunt-password').fill(huntPassword!);
    await page.locator('#hunt-login-form button[type="submit"]').click();
    await page.waitForURL(/\/hunt\/?$/);

    await page.goto('/hunt/reserve');
    await expect(page.locator('#hunt-reserve-form')).toBeVisible();
  });
});
