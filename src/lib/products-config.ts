import { z } from 'zod';

export const PRODUCTS_CONFIG_KV_KEY = 'products_config_v1';

export const ORDER_CHECKOUT_KEYS = [
  'premiumLine',
  'premiumCorner',
  'premiumExtraLong',
  'regularLine',
  'regularCorner',
  'bowStave',
] as const;

export type OrderCheckoutKey = (typeof ORDER_CHECKOUT_KEYS)[number];

/** Fallback images when `orderSkus[].image` is unset (admin can override per line item). */
export const ORDER_SKU_MARKETING_IMAGES: Record<OrderCheckoutKey, { src: string }> = {
  premiumLine: { src: '/images/hedge-posts.jpg' },
  premiumCorner: { src: '/images/hedge-posts.jpg' },
  premiumExtraLong: { src: '/images/hedge-posts.jpg' },
  regularLine: { src: '/images/hedge-posts.jpg' },
  regularCorner: { src: '/images/hedge-posts.jpg' },
  bowStave: { src: '/images/hedge-bowstave007.jpg' },
};

/** Resolved image URL/path for home, JSON-LD, and order form. */
export function getOrderSkuImageSrc(row: OrderSkuRow, key: OrderCheckoutKey): string {
  const t = row.image?.trim();
  if (t) return t;
  return ORDER_SKU_MARKETING_IMAGES[key].src;
}

/** Absolute image URL for JSON-LD (`siteBase` without trailing slash). */
export function getOrderSkuImageAbsoluteUrl(siteBase: string, row: OrderSkuRow, key: OrderCheckoutKey): string {
  const src = getOrderSkuImageSrc(row, key);
  if (src.startsWith('http://') || src.startsWith('https://')) return src;
  const site = siteBase.replace(/\/+$/, '');
  const path = src.startsWith('/') ? src : `/${src}`;
  return `${site}${path}`;
}

const orderSkuFieldSchema = z.enum([
  'premiumLine',
  'premiumCorner',
  'premiumExtraLong',
  'regularLine',
  'regularCorner',
  'bowStave',
]);

export const orderSkuRowSchema = z.object({
  fieldName: orderSkuFieldSchema,
  label: z.string().min(1),
  shortDescription: z.string().transform((s) => s.trim()),
  unitPrice: z.number().nonnegative(),
  /** SOLD OUT badge on /order-now. Server still rejects premiumExtraLong qty > 0 (see orders.ts). */
  soldOut: z.boolean(),
  /** Optional. Public path (e.g. /images/foo.jpg) or absolute URL. Empty uses ORDER_SKU_MARKETING_IMAGES. */
  image: z
    .string()
    .optional()
    .transform((s) => (s && s.trim() ? s.trim() : undefined)),
});

export type OrderSkuRow = z.infer<typeof orderSkuRowSchema>;

/** KV payload. Legacy saves may include removed fields (e.g. hedgeCatalog); they are ignored on read and stripped on write. */
export const productsConfigSchema = z.object({
  version: z.literal(1),
  orderSkus: z.array(orderSkuRowSchema),
});

export type ProductsConfig = z.infer<typeof productsConfigSchema>;

/** Accepts current or legacy JSON that included hedgeCatalog. */
const productsConfigParseSchema = z.object({
  version: z.literal(1),
  orderSkus: z.array(orderSkuRowSchema),
  hedgeCatalog: z.unknown().optional(),
});

function defaultOrderSkus(): OrderSkuRow[] {
  return [
    {
      fieldName: 'premiumLine',
      label: 'Premium Line Posts',
      shortDescription: '3-6" diameter, relatively straight, 9ft long',
      unitPrice: 25,
      soldOut: false,
    },
    {
      fieldName: 'premiumCorner',
      label: 'Premium Corner/Second Posts',
      shortDescription: '6-12" diameter, relatively straight, 9ft long',
      unitPrice: 40,
      soldOut: false,
    },
    {
      fieldName: 'premiumExtraLong',
      label: 'Premium Extra Long Posts',
      shortDescription: "At least 12' long, relatively straight",
      unitPrice: 60,
      soldOut: true,
    },
    {
      fieldName: 'regularLine',
      label: 'Regular Line Posts',
      shortDescription: '3-6" diameter, curvy, smaller or cut last year, 9ft long',
      unitPrice: 10,
      soldOut: false,
    },
    {
      fieldName: 'regularCorner',
      label: 'Regular Corner Posts',
      shortDescription: '8-14" diameter, curvy or cut last year, 9ft long',
      unitPrice: 20,
      soldOut: false,
    },
    {
      fieldName: 'bowStave',
      label: 'Traditional Bow Stave Logs',
      shortDescription:
        'Usually around 6" diameter, at least 6 ft long, no knots, hand-selected, pickup only',
      unitPrice: 125,
      soldOut: false,
    },
  ];
}

export function getDefaultProductsConfig(): ProductsConfig {
  return {
    version: 1,
    orderSkus: defaultOrderSkus(),
  };
}

function validateOrderSkusUnique(rows: OrderSkuRow[]): void {
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.fieldName)) throw new Error(`Duplicate order SKU: ${r.fieldName}`);
    seen.add(r.fieldName);
  }
  for (const k of ORDER_CHECKOUT_KEYS) {
    if (!seen.has(k)) throw new Error(`Missing order SKU: ${k}`);
  }
}

export function parseProductsConfigJson(raw: string): ProductsConfig {
  const parsed = JSON.parse(raw) as unknown;
  const cfg = productsConfigParseSchema.parse(parsed);
  validateOrderSkusUnique(cfg.orderSkus);
  return { version: 1, orderSkus: cfg.orderSkus };
}

/** Default checkout SKU map (for tests and sync callers without KV). */
export function getDefaultOrderSkuMap(): Record<OrderCheckoutKey, OrderSkuRow> {
  return orderSkusToMap(getDefaultProductsConfig().orderSkus);
}

export function orderSkusToMap(rows: OrderSkuRow[]): Record<OrderCheckoutKey, OrderSkuRow> {
  validateOrderSkusUnique(rows);
  const m = {} as Record<OrderCheckoutKey, OrderSkuRow>;
  for (const r of rows) {
    m[r.fieldName] = r;
  }
  return m;
}

export async function getProductsConfig(kv: KVNamespace | undefined): Promise<ProductsConfig> {
  const fallback = structuredClone(getDefaultProductsConfig());
  if (!kv) return fallback;
  try {
    const raw = await kv.get(PRODUCTS_CONFIG_KV_KEY);
    if (!raw?.trim()) return fallback;
    return parseProductsConfigJson(raw);
  } catch (e) {
    console.warn('[products-config] invalid KV config, using defaults:', e);
    return fallback;
  }
}

export async function putProductsConfig(kv: KVNamespace, config: ProductsConfig): Promise<void> {
  validateOrderSkusUnique(config.orderSkus);
  productsConfigSchema.parse(config);
  await kv.put(PRODUCTS_CONFIG_KV_KEY, JSON.stringify(config));
}

export function buildHomeProductJsonLd(
  siteBase: string,
  orderSkus: OrderSkuRow[]
): Record<string, unknown>[] {
  const site = siteBase.replace(/\/+$/, '');
  const map = orderSkusToMap(orderSkus);
  const orderUrl = `${site}/order-now`;
  const bowUrl = `${site}/osage-bow-staves`;

  return ORDER_CHECKOUT_KEYS.map((key) => {
    const sku = map[key];
    const url = key === 'bowStave' ? bowUrl : orderUrl;
    const inStock = !sku.soldOut;
    return {
      '@type': 'Product',
      name: sku.label,
      description: sku.shortDescription,
      image: getOrderSkuImageAbsoluteUrl(site, sku, key),
      brand: { '@type': 'Brand', name: 'Southwest Iowa Hedge' },
      offers: {
        '@type': 'Offer',
        price: String(sku.unitPrice),
        priceCurrency: 'USD',
        availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        url,
      },
    };
  });
}
