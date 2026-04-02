import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: (...args: unknown[]) => mockSend(...args) };
  },
}));

vi.mock('../../../src/lib/server-env', () => ({
  getServerEnv: vi.fn(),
}));

import { getServerEnv } from '../../../src/lib/server-env';
import { POST } from '../../../src/pages/api/send-order-email';

const baseQuantities = {
  premiumLine: 1,
  premiumCorner: 0,
  premiumExtraLong: 0,
  regularLine: 0,
  regularCorner: 0,
  bowStave: 0,
};

const baseCustomer = {
  firstName: 'Test',
  lastName: 'User',
  email: 'test@example.com',
  phone: '7125550100',
};

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/send-order-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/send-order-email', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(''),
        } as Response)
      )
    );
    vi.mocked(getServerEnv).mockImplementation((key: string) => {
      if (key === 'RESEND_API_KEY') return 're_test_key';
      if (key === 'ORDER_NOTIFICATION_EMAIL') return 'owner@test.com';
      return undefined;
    });
    mockSend.mockResolvedValue({ data: { id: 'email_1' }, error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 503 when RESEND_API_KEY is missing', async () => {
    vi.mocked(getServerEnv).mockReturnValue(undefined);
    const res = await POST({
      request: jsonRequest({
        customerInfo: baseCustomer,
        quantities: baseQuantities,
        orderTotal: 25,
        isDeposit: false,
        depositAmount: 0,
      }),
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 400 when no line items', async () => {
    const res = await POST({
      request: jsonRequest({
        customerInfo: baseCustomer,
        quantities: { ...baseQuantities, premiumLine: 0 },
        orderTotal: 0,
        isDeposit: false,
        depositAmount: 0,
      }),
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it('returns 400 when premium extra long > 0 (sold out)', async () => {
    const res = await POST({
      request: jsonRequest({
        customerInfo: baseCustomer,
        quantities: { ...baseQuantities, premiumExtraLong: 1 },
        orderTotal: 60,
        isDeposit: false,
        depositAmount: 0,
      }),
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it('returns 200 and calls Resend when payload is valid', async () => {
    const res = await POST({
      request: jsonRequest({
        customerInfo: { ...baseCustomer, notes: 'Gate by north field' },
        quantities: baseQuantities,
        orderTotal: 25,
        isDeposit: false,
        depositAmount: 0,
      }),
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(2);
    const ownerCall = mockSend.mock.calls[0][0];
    expect(ownerCall.to).toContain('owner@test.com');
    expect(ownerCall.replyTo).toBe('test@example.com');
    const customerCall = mockSend.mock.calls[1][0];
    expect(customerCall.to).toContain('test@example.com');
    expect(customerCall.replyTo).toBe('owner@test.com');
    expect(String(customerCall.html)).toContain('cal.com/chad-williams-donsre/hedge-pickup');
    expect(String(customerCall.html)).toContain('712-254-3999');
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.customerEmailId).toBeDefined();
    expect(globalThis.fetch).toHaveBeenCalled();
    const ntfyCall = vi.mocked(globalThis.fetch).mock.calls.find(
      (c) => typeof c[0] === 'string' && String(c[0]).includes('ntfy.sh')
    );
    expect(ntfyCall).toBeDefined();
  });
});
