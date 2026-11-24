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

vi.mock('../../../src/lib/orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/orders')>();
  return { ...actual, getOrder: vi.fn() };
});

import { getServerEnv } from '../../../src/lib/server-env';
import { getOrdersKvFromLocals } from '../../../src/lib/orders-kv';
import { getOrder } from '../../../src/lib/orders';
import { POST } from '../../../src/pages/api/admin/send-ready-notice';
import type { StoredOrder } from '../../../src/lib/order-types';

function makeOrder(id: string, over: Partial<StoredOrder> = {}): StoredOrder {
  return {
    id,
    createdAt: '2026-11-01T15:00:00.000Z',
    customer: { name: 'Jane Doe', firstName: 'Jane', lastName: 'Doe', email: `${id}@example.com`, phone: '' },
    items: [{ product: 'Premium Line Posts', fieldName: 'premiumLine', quantity: 10, unitPrice: 25, lineTotal: 250 }],
    subtotal: 250,
    volumeDiscount: { applied: false, rate: 0, amount: 0, mode: 'none' },
    discountedSubtotal: 250,
    deposit: { selected: true, rate: 0.1, amount: 25 },
    orderTotal: 250,
    depositAmount: 25,
    depositPayRail: 'venmo',
    depositReceived: { at: '2026-11-02T00:00:00.000Z', via: 'manual' },
    balanceDue: 225,
    notes: null,
    deliverySlot: null,
    status: 'pending',
    ...over,
  };
}

const put = vi.fn();

function req(body: unknown) {
  return new Request('http://localhost/api/admin/send-ready-notice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function call(body: unknown) {
  const res = await POST({ request: req(body), locals: {} } as never);
  return { status: res.status, data: await res.json() };
}

describe('POST /api/admin/send-ready-notice', () => {
  const store: Record<string, StoredOrder> = {};

  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({ data: { id: 'email_1' }, error: null });
    put.mockReset();
    for (const k of Object.keys(store)) delete store[k];
    store.a = makeOrder('a');
    store.b = makeOrder('b', { readyNotice: { sentAt: '2026-11-10T00:00:00.000Z', to: 'b@example.com' } });
    store.c = makeOrder('c', { status: 'canceled' });
    vi.mocked(getOrdersKvFromLocals).mockReturnValue({ put } as never);
    vi.mocked(getOrder).mockImplementation(async (_kv, id) => (store[id] ? structuredClone(store[id]) : null));
    vi.mocked(getServerEnv).mockImplementation((key: string) => (key === 'RESEND_API_KEY' ? 're_test' : undefined));
  });

  it('emails the customer with the amount due and stamps readyNotice', async () => {
    const { status, data } = await call({ ids: ['a'] });
    expect(status).toBe(200);
    expect(data.sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const msg = mockSend.mock.calls[0]![0] as { to: string[]; html: string; subject: string };
    expect(msg.to).toEqual(['a@example.com']);
    expect(msg.subject).toContain('ready for pickup');
    expect(msg.html).toContain('$225.00');
    expect(msg.html).toContain('cal.com');
    const saved = JSON.parse(put.mock.calls[0]![1] as string) as StoredOrder;
    expect(saved.readyNotice?.to).toBe('a@example.com');
    expect(saved.revisionLog?.at(-1)?.summary).toContain('Ready-for-pickup');
  });

  it('skips already-notified and canceled orders, reports missing ones', async () => {
    const { data } = await call({ ids: ['a', 'b', 'c', 'zzz'] });
    expect(data.sent).toBe(1);
    const byId = Object.fromEntries((data.results as Array<{ id: string }>).map((r) => [r.id, r]));
    expect(byId.b).toMatchObject({ ok: false, skipped: true });
    expect(byId.c).toMatchObject({ ok: false, skipped: true });
    expect(byId.zzz).toMatchObject({ ok: false, error: 'Order not found' });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('resends to an already-notified order when asked', async () => {
    const { data } = await call({ ids: ['b'], resend: true });
    expect(data.sent).toBe(1);
  });

  it('one failed send does not stop the batch', async () => {
    store.d = makeOrder('d');
    mockSend
      .mockResolvedValueOnce({ data: null, error: { message: 'bad address' } })
      .mockResolvedValueOnce({ data: { id: 'email_2' }, error: null });
    const { data } = await call({ ids: ['a', 'd'] });
    expect(data.sent).toBe(1);
    expect(data.results[0]).toMatchObject({ id: 'a', ok: false, error: 'bad address' });
    expect(data.results[1]).toMatchObject({ id: 'd', ok: true });
  });

  it('requires ids and an email key', async () => {
    expect((await call({})).status).toBe(400);
    vi.mocked(getServerEnv).mockReturnValue(undefined);
    expect((await call({ ids: ['a'] })).status).toBe(503);
  });
});
