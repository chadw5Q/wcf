/** How hunters pay Williams Creek Whitetails: Venmo, a mailed check, or Stripe (bank ACH or card). */

export type HuntPayRail = 'venmo' | 'check' | 'ach' | 'card';

export const HUNT_VENMO_HANDLE = '@cchadww';

export const HUNT_CHECK_PAYEE = 'Williams Creek Farms';

export const HUNT_CHECK_MAIL_TO = [
  'Williams Creek Whitetails',
  '65064 Troublesome Cr Rd',
  'Atlantic, IA 50022',
] as const;

export function huntVenmoPayUrl(amountUsd: number, note: string): string {
  return `https://venmo.com/${HUNT_VENMO_HANDLE.slice(1)}?txn=pay&amount=${amountUsd.toFixed(2)}&note=${encodeURIComponent(note)}`;
}

export function parseHuntPayRail(raw: unknown): HuntPayRail {
  return raw === 'check' || raw === 'ach' || raw === 'card' ? raw : 'venmo';
}
