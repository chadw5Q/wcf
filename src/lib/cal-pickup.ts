/** Public Cal.com event URL for hedge pickup scheduling. */
export const CAL_PICKUP_BOOKING_URL = 'https://cal.com/chad-williams-donsre/hedge-pickup';

/**
 * Booking link with optional `orderId` query param so Cal.com can echo it in webhooks
 * (add a matching short-text field on the event, e.g. slug `orderId`, or rely on URL → responses).
 */
export function pickupScheduleUrl(orderId?: string | null): string {
  const id = orderId?.trim();
  if (!id) return CAL_PICKUP_BOOKING_URL;
  const u = new URL(CAL_PICKUP_BOOKING_URL);
  u.searchParams.set('orderId', id);
  return u.toString();
}
