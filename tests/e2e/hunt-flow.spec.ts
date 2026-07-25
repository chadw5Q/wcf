import { test, expect } from '@playwright/test';
import { createHuntPortalToken } from '../../src/lib/hunt-portal-token';

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

  test('POST /api/hunt-portal-checkout rejects invalid portal token', async ({ request }) => {
    const res = await request.post('/api/hunt-portal-checkout', {
      headers: { 'Content-Type': 'application/json' },
      data: { token: 'not-a-valid-token', kind: 'deposit', rail: 'card' },
    });
    expect(res.status()).not.toBe(302);
    expect(res.headers()['location'] ?? '').not.toContain('/hunt/login');
    expect(res.status()).toBe(401);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toMatch(/invalid|expired/i);
  });
});

test.describe('Hunt public guest pages (no login)', () => {
  test('Know Before You Go loads without hunt session', async ({ page }) => {
    const res = await page.goto('/hunt/know-before-you-go');
    expect(res?.status()).toBeLessThan(400);
    await expect(page).not.toHaveURL(/\/hunt\/login/);
    await expect(page.getByRole('heading', { name: /Know Before You Go/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Download PDF/i })).toBeVisible();
  });

  test('invalid portal token is not redirected to login', async ({ page }) => {
    await page.goto('/hunt/portal/not-a-real-token');
    await expect(page).not.toHaveURL(/\/hunt\/login/);
    await expect(page.getByRole('heading', { name: /Link not valid/i })).toBeVisible();
  });

  test('signed portal token route is ungated (shows valid or missing reservation)', async ({ page }) => {
    // Same default secret as local DEV when HUNT_PASSWORD is unset.
    const token = await createHuntPortalToken(
      '00000000-0000-4000-8000-000000000000',
      0,
      process.env.HUNT_E2E_PASSWORD || process.env.HUNT_PASSWORD || 'HuntIowa2026'
    );
    await page.goto(`/hunt/portal/${encodeURIComponent(token)}`);
    await expect(page).not.toHaveURL(/\/hunt\/login/);
    // Without HUNT_KV locally there is no reservation → invalid; with KV + matching id it would welcome.
    await expect(
      page.getByRole('heading', { name: /Link not valid|Welcome,/i })
    ).toBeVisible();
  });

  test('portal payment route is ungated', async ({ page }) => {
    const token = await createHuntPortalToken(
      '00000000-0000-4000-8000-000000000000',
      0,
      process.env.HUNT_E2E_PASSWORD || process.env.HUNT_PASSWORD || 'HuntIowa2026'
    );
    await page.goto(`/hunt/portal/${encodeURIComponent(token)}/payment`);
    await expect(page).not.toHaveURL(/\/hunt\/login/);
    await expect(
      page.getByRole('heading', { name: /Link not valid|Thank you,|Welcome,/i })
    ).toBeVisible();
  });
});

/**
 * Optional: set `HUNT_E2E_PASSWORD` to match `HUNT_PASSWORD` on the dev server
 * (defaults to `HuntIowa2026` in local DEV when unset).
 */
test.describe('Hunt reserve payment rails', () => {
  test('login → reserve shows Venmo/ACH/card and bakes 3% into card total', async ({ page }) => {
    const huntPassword = process.env.HUNT_E2E_PASSWORD || 'HuntIowa2026';

    await page.goto('/hunt/login');
    await page.locator('#hunt-password').fill(huntPassword);
    await page.locator('#hunt-login-form button[type="submit"]').click();
    await page.waitForURL(/\/hunt\/?$/);

    await page.goto('/hunt/reserve');
    await expect(page.locator('#hunt-reserve-form')).toBeVisible();

    await expect(page.getByText('How will you pay the deposit?')).toBeVisible();
    await expect(page.locator('input[name="payRail"][value="venmo"]')).toBeChecked();
    await expect(page.locator('#hunt-summary-pay')).toContainText(/Venmo/i);
    await expect(page.locator('#hunt-summary-pay')).toContainText('$500');

    await page.locator('input[name="payRail"][value="card"]').check();
    await expect(page.locator('#hunt-summary-pay')).toContainText(/card/i);
    await expect(page.locator('#hunt-summary-pay')).toContainText('3%');
    await expect(page.locator('#hunt-summary-pay')).toContainText('$515');
    await expect(page.locator('#hunt-submit')).toContainText('$515');

    await page.locator('input[name="payRail"][value="ach"]').check();
    await expect(page.locator('#hunt-summary-pay')).toContainText(/ACH/i);
    await expect(page.locator('#hunt-summary-pay')).toContainText('0.8%');

    // Meal package updates summary
    await page.locator('#hunt-meal').check();
    await expect(page.locator('#hunt-summary-lines')).toContainText(/Meals/i);
    await expect(page.locator('#hunt-summary-total')).toContainText('$4,000');
    await expect(page.locator('#hunt-summary-balance')).toContainText('$3,500');
  });

  test('reserve API venmo rail returns venmoUrl when HUNT_KV is bound', async ({ request }) => {
    const probe = await request.post('/api/hunt-reserve', {
      headers: { 'Content-Type': 'application/json' },
      data: {},
    });
    test.skip(probe.status() === 503, 'HUNT_KV not bound in this environment (astro dev often has no Worker KV).');

    const res = await request.post('/api/hunt-reserve', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        hunters: [
          {
            firstName: 'E2E',
            lastName: 'Guest',
            email: 'e2e-hunt@example.com',
            phone: '7125550199',
            state: 'IA',
          },
        ],
        huntYear: 2028,
        preferredWeek: 'w2',
        mealPackage: false,
        notes: null,
        payRail: 'venmo',
      },
    });

    // 400 = week unavailable / validation; 200 = happy path
    if (res.status() === 400) {
      const body = await res.json();
      test.info().annotations.push({ type: 'note', description: JSON.stringify(body) });
      return;
    }

    expect(res.status()).toBe(200);
    const json = (await res.json()) as { payRail?: string; venmoUrl?: string; confirmUrl?: string };
    expect(json.payRail).toBe('venmo');
    expect(json.venmoUrl).toContain('venmo.com/cchadww');
    expect(json.confirmUrl).toContain('pay=venmo');
  });
});
