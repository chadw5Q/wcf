import { describe, expect, it } from 'vitest';
import { getAllContacts } from '../../../src/lib/contacts';
import { POST as logInteraction } from '../../../src/pages/api/admin/log-interaction';
import { POST as createOrder } from '../../../src/pages/api/orders';

function memoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/log-interaction', () => {
  it('requires a phone or email', async () => {
    const kv = memoryKv();
    const res = await logInteraction({
      request: jsonRequest('http://localhost/api/admin/log-interaction', {
        firstName: 'Ada',
        lastName: 'Lovelace',
        channel: 'phone',
        summary: 'Called',
      }),
      locals: { runtime: { env: { ORDERS_KV: kv } } },
    } as Parameters<typeof logInteraction>[0]);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/phone number or an email/i);
  });

  it('saves an interaction and returns the contact id', async () => {
    const kv = memoryKv();
    const res = await logInteraction({
      request: jsonRequest('http://localhost/api/admin/log-interaction', {
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: '7125550199',
        channel: 'phone',
        summary: 'Asked about 40 line posts',
        followUpOn: '2026-04-15',
      }),
      locals: { runtime: { env: { ORDERS_KV: kv } } },
    } as Parameters<typeof logInteraction>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    const contacts = await getAllContacts(kv);
    expect(contacts).toHaveLength(1);
    expect(body.contactId).toBe(contacts[0].id);
    expect(contacts[0].interactions[0].followUpOn).toBe('2026-04-15');
  });
});

describe('POST /api/orders contact link', () => {
  it('attaches a web order to a contact', async () => {
    const kv = memoryKv();
    const locals = { runtime: { env: { ORDERS_KV: kv } } };
    const res = await createOrder({
      request: jsonRequest('http://localhost/api/orders', {
        customerInfo: {
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
          phone: '7125550199',
          notes: 'Gate code 12',
        },
        quantities: {
          premiumLine: 2,
          premiumCorner: 0,
          regularLine: 0,
          regularCorner: 0,
          discountBin: 0,
          bowStave: 0,
        },
        depositSelected: false,
      }),
      locals,
    } as Parameters<typeof createOrder>[0]);
    expect(res.status).toBe(200);
    const contacts = await getAllContacts(kv);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].interactions[0].channel).toBe('web');
    expect(contacts[0].interactions[0].summary).toContain('Gate code 12');
    expect(contacts[0].interactions[0].orderId).toBeTruthy();
  });
});
