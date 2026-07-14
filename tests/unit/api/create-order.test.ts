import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/lib/server-env', () => ({
  getServerEnv: vi.fn(),
}));

vi.mock('../../../src/lib/orders-kv', () => ({
  getOrdersKvFromLocals: vi.fn(),
}));

vi.mock('../../../src/lib/ntfy', () => ({
  publishNtfyNotification: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../src/lib/products-config', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/lib/products-config')>();
  return {
    ...mod,
    getProductsConfig: vi.fn(async () => mod.getDefaultProductsConfig()),
  };
});

import { getServerEnv } from '../../../src/lib/server-env';
import { getOrdersKvFromLocals } from '../../../src/lib/orders-kv';
import { publishNtfyNotification } from '../../../src/lib/ntfy';
import { POST } from '../../../src/pages/api/admin/create-order';

const put = vi.fn(async () => undefined);
const get = vi.fn(async () => null);

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/admin/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const basePayload = {
  firstName: 'Walk',
  lastName: 'In',
  email: 'walkin@example.com',
  phone: '7125550199',
  notes: 'Paid cash on site',
  quantities: {
    premiumLine: 2,
    premiumCorner: 0,
    regularLine: 0,
    regularCorner: 0,
    discountBin: 0,
    bowStave: 0,
  },
  depositAmount: 10,
  status: 'fulfilled',
};

describe('POST /api/admin/create-order', () => {
  beforeEach(() => {
    put.mockClear();
    get.mockClear();
    vi.mocked(publishNtfyNotification).mockClear();
    vi.mocked(getOrdersKvFromLocals).mockReturnValue({ get, put } as never);
    vi.mocked(getServerEnv).mockImplementation((key: string) => {
      if (key === 'SITE_URL') return 'https://williamscreekfarms.com';
      return undefined;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 503 when ORDERS_KV is missing', async () => {
    vi.mocked(getOrdersKvFromLocals).mockReturnValue(undefined);
    const res = await POST({
      request: jsonRequest(basePayload),
      locals: {},
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(503);
  });

  it('creates a fulfilled walk-in order without schedule email and notifies ntfy', async () => {
    get.mockResolvedValueOnce(null); // order index empty
    const res = await POST({
      request: jsonRequest(basePayload),
      locals: {},
    } as Parameters<typeof POST>[0]);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.orderId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(body.order.status).toBe('fulfilled');
    expect(body.order.depositAmount).toBe(10);
    expect(body.order.customer.email).toBe('walkin@example.com');
    expect(put).toHaveBeenCalled();
    expect(publishNtfyNotification).toHaveBeenCalledTimes(1);
    const ntfyArg = vi.mocked(publishNtfyNotification).mock.calls[0][0];
    expect(ntfyArg.title).toMatch(/Walk-in order/);
    expect(ntfyArg.message).toMatch(/No schedule email sent/);
  });

  it('defaults deposit to 0 and status to fulfilled', async () => {
    get.mockResolvedValueOnce(null);
    const res = await POST({
      request: jsonRequest({
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.com',
        phone: '',
        notes: null,
        quantities: basePayload.quantities,
      }),
      locals: {},
    } as Parameters<typeof POST>[0]);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order.status).toBe('fulfilled');
    expect(body.order.depositAmount).toBe(0);
    expect(body.order.deposit.selected).toBe(false);
  });

  it('returns 400 when no line items', async () => {
    const res = await POST({
      request: jsonRequest({
        ...basePayload,
        quantities: {
          premiumLine: 0,
          premiumCorner: 0,
          regularLine: 0,
          regularCorner: 0,
          discountBin: 0,
          bowStave: 0,
        },
      }),
      locals: {},
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/at least one/i);
  });
});
