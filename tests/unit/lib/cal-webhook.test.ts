import { describe, it, expect } from 'vitest';
import {
  extractOrderIdFromCalPayload,
  formatCalPickupSlot,
  hmacSha256Hex,
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

  it('returns undefined when no UUID', () => {
    expect(extractOrderIdFromCalPayload({ responses: { name: { value: 'Jane' } } })).toBeUndefined();
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

  it('rejects wrong signature', async () => {
    const secret = 'test-secret';
    const body = '{}';
    expect(await verifyCalWebhookSignature(body, 'deadbeef', secret)).toBe(false);
  });
});
