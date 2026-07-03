/** Quantity field names aligned with checkout / KV. */
export const ORDER_QUANTITY_KEYS = [
  'premiumLine',
  'premiumCorner',
  'regularLine',
  'regularCorner',
  'discountBin',
  'bowStave',
] as const;

export type OrderQuantityKey = (typeof ORDER_QUANTITY_KEYS)[number];
