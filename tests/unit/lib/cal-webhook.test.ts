import { describe, it, expect } from 'vitest';
import {
  extractCalBookingTimes,
  extractOrderIdFromCalPayload,
  extractOrderIdFromRawBody,
  extractOrderIdFromUrlString,
  formatCalBookingAlertWithoutOrderId,
  formatCalBookingOrderNotFoundAlert,
  formatCalPickupSlot,
  hmacSha256Hex,
  normalizeCalPayload,
  normalizeCalTriggerEvent,
  resolveOrderIdFromCalWebhook,
  verifyCalWebhookSignature,
} from '../../../src/lib/cal-webhook';

const SAMPLE_ID = 'a0a84e55-7879-4b3a-980f-6fafe4bff099';

describe('extractOrderIdFromCalPayload', () => {
  it('reads top-level orderId', () => {
    expect(extractOrderIdFromCalPayload({ orderId: SAMPLE_ID })).toBe(SAMPLE_ID);
  });

  it('reads responses.orderId value object', () => {
    expect(
      extractOrderIdFromCalPayload({
        responses: {
          orderId: { label: 'Order ID', value: SAMPLE_ID },
        },
      })
    ).toBe(SAMPLE_ID);
  });

  it('reads responses["order-id"] string', () => {
    expect(
      extractOrderIdFromCalPayload({
        responses: { 'order-id': SAMPLE_ID },
      })
    ).toBe(SAMPLE_ID);
  });

  it('reads metadata.order_id', () => {
    expect(
      extractOrderIdFromCalPayload({
        metadata: { order_id: SAMPLE_ID },
      })
    ).toBe(SAMPLE_ID);
  });

  it('reads order id from bookerUrl query string', () => {
    expect(
      extractOrderIdFromCalPayload({
        bookerUrl: `https://cal.com/foo?orderId=${SAMPLE_ID}&bar=1`,
      })
    ).toBe(SAMPLE_ID);
  });

  it('reads userFieldsResponses', () => {
    expect(
      extractOrderIdFromCalPayload({
        userFieldsResponses: {
          orderId: { label: 'Order ID', value: SAMPLE_ID },
        },
      })
    ).toBe(SAMPLE_ID);
  });

  it('matches response keys case-insensitively', () => {
    expect(
      extractOrderIdFromCalPayload({
        responses: {
          'Order ID': { value: SAMPLE_ID },
        },
      })
    ).toBe(SAMPLE_ID);
  });

  it('returns undefined when no UUID', () => {
    expect(extractOrderIdFromCalPayload({ responses: { name: { value: 'Jane' } } })).toBeUndefined();
  });
});

describe('extractOrderIdFromRawBody', () => {
  it('finds orderId in JSON text even when not in parsed responses', () => {
    const raw = `{"triggerEvent":"BOOKING_CREATED","payload":{"startTime":"2026-01-01T10:00:00Z","endTime":"2026-01-01T10:30:00Z","responses":{"name":{"value":"Jane"}},"bookerUrl":"https://cal.com/x?orderId=${SAMPLE_ID}"}}`;
    expect(extractOrderIdFromRawBody(raw)).toBe(SAMPLE_ID);
  });

  it('finds "orderId":"uuid" key in payload', () => {
    const raw = `{"triggerEvent":"BOOKING_CREATED","payload":{"orderId":"${SAMPLE_ID}","startTime":"2026-01-01T10:00:00Z","endTime":"2026-01-01T10:30:00Z"}}`;
    expect(extractOrderIdFromRawBody(raw)).toBe(SAMPLE_ID);
  });

  it('finds "order-id":"uuid" key in JSON', () => {
    const raw = `{"payload":{"order-id":"${SAMPLE_ID}"}}`;
    expect(extractOrderIdFromRawBody(raw)).toBe(SAMPLE_ID);
  });
});

describe('resolveOrderIdFromCalWebhook', () => {
  it('falls back from raw body when structured payload lacks orderId', () => {
    const raw = `{"triggerEvent":"BOOKING_CREATED","payload":{"startTime":"2026-01-01T10:00:00Z","endTime":"2026-01-01T10:30:00Z","notes":"see https://cal.com/h?orderId=${SAMPLE_ID}"}}`;
    const body = JSON.parse(raw) as Record<string, unknown>;
    const { payload } = normalizeCalPayload(body);
    expect(resolveOrderIdFromCalWebhook(raw, body, payload)).toBe(SAMPLE_ID);
  });

  it('does not treat Cal top-level uid as order id when responses lack order', () => {
    const calUid = '11111111-2222-4333-8444-555555555555';
    const body = {
      triggerEvent: 'BOOKING_CREATED',
      payload: {
        uid: calUid,
        startTime: '2026-01-01T10:00:00.000Z',
        endTime: '2026-01-01T10:30:00.000Z',
        responses: { name: { value: 'Pat' } },
      },
    };
    const raw = JSON.stringify(body);
    const { payload } = normalizeCalPayload(body as Record<string, unknown>);
    expect(resolveOrderIdFromCalWebhook(raw, body as Record<string, unknown>, payload)).toBeUndefined();
  });

  it('prefers responses.orderId over Cal uid on payload', () => {
    const calUid = '11111111-2222-4333-8444-555555555555';
    const body = {
      triggerEvent: 'BOOKING_CREATED',
      payload: {
        uid: calUid,
        startTime: '2026-01-01T10:00:00.000Z',
        endTime: '2026-01-01T10:30:00.000Z',
        responses: { orderId: { value: SAMPLE_ID } },
      },
    };
    const raw = JSON.stringify(body);
    const { payload } = normalizeCalPayload(body as Record<string, unknown>);
    expect(resolveOrderIdFromCalWebhook(raw, body as Record<string, unknown>, payload)).toBe(SAMPLE_ID);
  });
});

describe('extractOrderIdFromUrlString', () => {
  it('parses orderId query param', () => {
    expect(extractOrderIdFromUrlString(`https://x.com/y?orderId=${SAMPLE_ID}`)).toBe(SAMPLE_ID);
  });

  it('parses order-id query param', () => {
    expect(extractOrderIdFromUrlString(`https://x.com/y?order-id=${SAMPLE_ID}`)).toBe(SAMPLE_ID);
  });

  it('parses orderID query param (case variant)', () => {
    expect(extractOrderIdFromUrlString(`https://x.com/y?orderID=${SAMPLE_ID}`)).toBe(SAMPLE_ID);
  });
});

describe('formatCalBookingAlertWithoutOrderId', () => {
  it('includes trigger and slot when times present', () => {
    const msg = formatCalBookingAlertWithoutOrderId(
      {
        startTime: '2026-04-15T15:00:00.000Z',
        endTime: '2026-04-15T15:30:00.000Z',
        attendees: [{ name: 'Pat', email: 'p@example.com' }],
      },
      'BOOKING_CREATED'
    );
    expect(msg).toContain('BOOKING_CREATED');
    expect(msg).toContain('Pat');
    expect(msg).toContain('p@example.com');
    expect(msg).toContain('orderId');
  });
});

describe('formatCalBookingOrderNotFoundAlert', () => {
  it('includes resolved id and trigger', () => {
    const msg = formatCalBookingOrderNotFoundAlert(
      SAMPLE_ID,
      {
        startTime: '2026-04-15T15:00:00.000Z',
        endTime: '2026-04-15T15:30:00.000Z',
      },
      'BOOKING_CREATED'
    );
    expect(msg).toContain(SAMPLE_ID);
    expect(msg).toContain('BOOKING_CREATED');
    expect(msg).toContain('NOT');
  });
});

describe('normalizeCalTriggerEvent', () => {
  it('maps booking.created to BOOKING_CREATED', () => {
    expect(normalizeCalTriggerEvent('booking.created')).toBe('BOOKING_CREATED');
  });
});

describe('normalizeCalPayload', () => {
  it('flattens nested booking object', () => {
    const { payload } = normalizeCalPayload({
      triggerEvent: 'BOOKING_CREATED',
      payload: {
        booking: {
          startTime: '2026-01-01T10:00:00.000Z',
          endTime: '2026-01-01T10:30:00.000Z',
          orderId: SAMPLE_ID,
        },
      },
    });
    expect(payload.startTime).toBe('2026-01-01T10:00:00.000Z');
    expect(payload.orderId).toBe(SAMPLE_ID);
  });
});

describe('extractCalBookingTimes', () => {
  it('uses start/end aliases', () => {
    expect(
      extractCalBookingTimes({
        start: '2026-01-01T10:00:00.000Z',
        end: '2026-01-01T10:30:00.000Z',
      })
    ).toEqual({ start: '2026-01-01T10:00:00.000Z', end: '2026-01-01T10:30:00.000Z' });
  });
});

describe('formatCalPickupSlot', () => {
  it('formats start/end in America/Chicago', () => {
    const s = formatCalPickupSlot('2026-04-15T15:00:00.000Z', '2026-04-15T15:30:00.000Z');
    expect(s).toContain('2026');
    expect(s).toContain('–');
  });
});

describe('verifyCalWebhookSignature', () => {
  it('accepts valid x-cal-signature-256', async () => {
    const secret = 'test-secret';
    const body = '{"triggerEvent":"BOOKING_CREATED"}';
    const hex = await hmacSha256Hex(secret, body);
    expect(await verifyCalWebhookSignature(body, hex, secret)).toBe(true);
  });

  it('accepts sha256= prefixed signature', async () => {
    const secret = 'test-secret';
    const body = '{"triggerEvent":"BOOKING_CREATED"}';
    const hex = await hmacSha256Hex(secret, body);
    expect(await verifyCalWebhookSignature(body, `sha256=${hex}`, secret)).toBe(true);
  });

  it('rejects wrong signature', async () => {
    const secret = 'test-secret';
    const body = '{}';
    expect(await verifyCalWebhookSignature(body, 'deadbeef', secret)).toBe(false);
  });
});
