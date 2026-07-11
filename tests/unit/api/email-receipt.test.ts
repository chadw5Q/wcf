import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: (...args: unknown[]) => mockSend(...args) };
  },
}));

vi.mock('../../../src/lib/server-env', () => ({
  getServerEnv: vi.fn(),
}));

vi.mock('../../../src/lib/orders-kv', () => ({
  getOrdersKvFromLocals: vi.fn(),
}));

vi.mock('../../../src/lib/orders', () => ({
  getOrder: vi.fn(),
}));

import { getServerEnv } from '../../../src/lib/server-env';
import { getOrdersKvFromLocals } from '../../../src/lib/orders-kv';
import { getOrder } from '../../../src/lib/orders';
import { POST } from '../../../src/pages/api/admin/email-receipt';
import type { StoredOrder } from '../../../src/lib/order-types';

const fulfilledOrder: StoredOrder = {
  id: '03142d11-3021-4d0f-a7c5-b1a43d69d5c4',
  createdAt: '2026-04-01T15:00:00.000Z',
  customer: {
    name: 'Jane Doe',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phone: '7125550100',
  },
  items: [
    {
      product: 'Premium Line Posts',
      fieldName: 'premiumLine',
      quantity: 10,
      unitPrice: 25,
      lineTotal: 250,
    },
  ],
  subtotal: 250,
  volumeDiscount: { applied: false, rate: 0.1, amount: 0 },
  discountedSubtotal: 250,
  deposit: { selected: true, rate: 0.1, amount: 25 },
  orderTotal: 250,
  depositAmount: 25,
  balanceDue: 225,
  notes: 'Gate code 1234',
  deliverySlot: 'Sat Apr 12, 9–11am',
  status: 'fulfilled',
};

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/admin/email-receipt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/email-receipt', () => {
  beforeEach(() => {
    mockSend.mockClear();
    mockSend.mockResolvedValue({ data: { id: 'email_1' }, error: null });
    vi.mocked(getOrdersKvFromLocals).mockReturnValue({} as never);
    vi.mocked(getOrder).mockResolvedValue(fulfilledOrder);
    vi.mocked(getServerEnv).mockImplementation((key: string) => {
      if (key === 'RESEND_API_KEY') return 're_test_key';
      if (key === 'ORDER_NOTIFICATION_EMAIL') return 'owner@test.com';
      return undefined;
    });
  });

  it('returns 503 when ORDERS_KV is missing', async () => {
    vi.mocked(getOrdersKvFromLocals).mockReturnValue(undefined);
    const res = await POST({
      request: jsonRequest({ id: fulfilledOrder.id }),
      locals: {},
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(503);
  });

  it('returns 503 when RESEND_API_KEY is missing', async () => {
    vi.mocked(getServerEnv).mockReturnValue(undefined);
    const res = await POST({
      request: jsonRequest({ id: fulfilledOrder.id }),
      locals: {},
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(503);
  });

  it('returns 400 when order is not fulfilled', async () => {
    vi.mocked(getOrder).mockResolvedValue({ ...fulfilledOrder, status: 'pending' });
    const res = await POST({
      request: jsonRequest({ id: fulfilledOrder.id }),
      locals: {},
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/fulfilled/i);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends receipt to customer and admin when fulfilled', async () => {
    mockSend
      .mockResolvedValueOnce({ data: { id: 'cust_1' }, error: null })
      .mockResolvedValueOnce({ data: { id: 'admin_1' }, error: null });

    const res = await POST({
      request: jsonRequest({ id: fulfilledOrder.id }),
      locals: {},
    } as Parameters<typeof POST>[0]);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.sentTo).toEqual({
      customer: 'jane@example.com',
      admin: 'owner@test.com',
    });
    expect(mockSend).toHaveBeenCalledTimes(2);

    const customerCall = mockSend.mock.calls[0][0];
    const adminCall = mockSend.mock.calls[1][0];
    expect(customerCall.to).toEqual(['jane@example.com']);
    expect(adminCall.to).toEqual(['owner@test.com']);
    expect(customerCall.html).toContain('Order receipt');
    expect(customerCall.html).toContain('Jane Doe');
    expect(customerCall.html).toContain('Premium Line Posts');
  });
});
