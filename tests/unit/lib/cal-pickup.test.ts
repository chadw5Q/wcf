import { describe, it, expect } from 'vitest';
import { CAL_PICKUP_BOOKING_URL, pickupScheduleUrl } from '../../../src/lib/cal-pickup';

describe('pickupScheduleUrl', () => {
  it('returns base URL when orderId is missing', () => {
    expect(pickupScheduleUrl()).toBe(CAL_PICKUP_BOOKING_URL);
    expect(pickupScheduleUrl('')).toBe(CAL_PICKUP_BOOKING_URL);
    expect(pickupScheduleUrl(null)).toBe(CAL_PICKUP_BOOKING_URL);
  });

  it('appends orderId query param', () => {
    const id = '30f628c4-2271-49e3-9e3d-6c5e47ace342';
    expect(pickupScheduleUrl(id)).toBe(
      `${CAL_PICKUP_BOOKING_URL}?orderId=${encodeURIComponent(id)}`
    );
  });
});
