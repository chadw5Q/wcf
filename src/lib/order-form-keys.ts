/** Quantity field names aligned with checkout / KV (extra-long always 0 — sold out). */
export const ORDER_QUANTITY_KEYS = [
  'premiumLine',
  'premiumCorner',
  'premiumExtraLong',
  'regularLine',
  'regularCorner',
  'bowStave',
] as const;

export type OrderQuantityKey = (typeof ORDER_QUANTITY_KEYS)[number];
