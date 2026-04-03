import { describe, it, expect } from 'vitest';
import {
  extractCalBookingTimes,
  extractOrderIdFromCalPayload,
  extractOrderIdFromUrlString,
  formatCalPickupSlot,
  hmacSha256Hex,
  normalizeCalPayload,
  normalizeCalTriggerEvent,
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

describe('extractOrderIdFromUrlString', () => {
  it('parses orderId query param', () => {
    expect(extractOrderIdFromUrlString(`https://x.com/y?orderId=${SAMPLE_ID}`)).toBe(SAMPLE_ID);
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
