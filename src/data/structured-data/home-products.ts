/** Product + ItemList JSON-LD for homepage pricing (https://schema.org). */
const SITE = 'https://williamscreekfarms.com';

export const homeProductSchemas = [
  {
    '@type': 'Product',
    name: 'Premium Line Hedge Posts (9 ft)',
    description:
      'Premium Osage Orange (hedge) line posts, 3–6 inch diameter, relatively straight, 9 feet long. Fresh cut in Southwest Iowa.',
    image: `${SITE}/images/hedge-posts.jpg`,
    brand: { '@type': 'Brand', name: 'Southwest Iowa Hedge' },
    offers: {
      '@type': 'Offer',
      price: '25',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url: `${SITE}/order-now`,
    },
  },
  {
    '@type': 'Product',
    name: 'Premium Corner / Second Hedge Posts (9 ft)',
    description:
      'Premium Osage Orange corner posts, 6–12 inch diameter, relatively straight, 9 feet long.',
    image: `${SITE}/images/hedge-posts.jpg`,
    brand: { '@type': 'Brand', name: 'Southwest Iowa Hedge' },
    offers: {
      '@type': 'Offer',
      price: '40',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url: `${SITE}/order-now`,
    },
  },
  {
    '@type': 'Product',
    name: 'Premium Extra Long Hedge Posts (12+ ft)',
    description:
      'Premium Osage Orange extra long posts, at least 12 feet, relatively straight.',
    image: `${SITE}/images/hedge-posts.jpg`,
    brand: { '@type': 'Brand', name: 'Southwest Iowa Hedge' },
    offers: {
      '@type': 'Offer',
      price: '60',
      priceCurrency: 'USD',
      availability: 'https://schema.org/OutOfStock',
      url: `${SITE}/order-now`,
    },
  },
  {
    '@type': 'Product',
    name: 'Regular Line Hedge Posts (9 ft)',
    description:
      'Regular Osage Orange line posts, 3–6 inch diameter, curvy, smaller or cut last year, 9 feet long.',
    image: `${SITE}/images/hedge-posts.jpg`,
    brand: { '@type': 'Brand', name: 'Southwest Iowa Hedge' },
    offers: {
      '@type': 'Offer',
      price: '10',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url: `${SITE}/order-now`,
    },
  },
  {
    '@type': 'Product',
    name: 'Regular Corner Hedge Posts (9 ft)',
    description:
      'Regular Osage Orange corner posts, 8–14 inch diameter, curvy or last cut last year, 9 feet long.',
    image: `${SITE}/images/hedge-posts.jpg`,
    brand: { '@type': 'Brand', name: 'Southwest Iowa Hedge' },
    offers: {
      '@type': 'Offer',
      price: '20',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url: `${SITE}/order-now`,
    },
  },
  {
    '@type': 'Product',
    name: 'Traditional Osage Orange Bow Stave Log',
    description:
      'Hand-selected bow stave log, ~6 inch diameter, 6+ feet, ends sealed within 24 hours. Pickup only.',
    image: `${SITE}/images/hedge-bowstave007.jpg`,
    brand: { '@type': 'Brand', name: 'Southwest Iowa Hedge' },
    offers: {
      '@type': 'Offer',
      price: '125',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url: `${SITE}/osage-bow-staves`,
    },
  },
];
