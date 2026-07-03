import { verifyHuntPassword } from './hunt-auth';
import { getServerEnv } from './server-env';

/**
 * Named guests with their own `/hunt` login password and a personal landing
 * page. A guest login grants the same `hunt_session` as the master password,
 * so guests can browse every `/hunt` page.
 */
export type HuntGuest = {
  slug: string;
  name: string;
  /** Env var holding this guest's password (Cloudflare secret / `.env`). */
  passwordEnv: string;
  /** Local-dev fallback so the flow works without env setup. */
  devDefaultPassword: string;
  landingPath: string;
};

export const HUNT_GUESTS: readonly HuntGuest[] = [
  {
    slug: 'allen-wright',
    name: 'Allen Wright',
    passwordEnv: 'HUNT_GUEST_ALLEN_PASSWORD',
    devDefaultPassword: 'AllenGun2026',
    landingPath: '/hunt/guest/allen-wright',
  },
];

export function getHuntGuestBySlug(slug: string): HuntGuest | undefined {
  return HUNT_GUESTS.find((g) => g.slug === slug);
}

export function getHuntGuestPassword(guest: HuntGuest): string | undefined {
  const p = getServerEnv(guest.passwordEnv)?.trim();
  if (p) return p;
  try {
    if (import.meta.env.DEV) return guest.devDefaultPassword;
  } catch {
    /* import.meta unavailable in some tests */
  }
  return undefined;
}

/** Match a submitted password against configured guest passwords (timing-safe per guest). */
export function findHuntGuestByPassword(plain: string): HuntGuest | undefined {
  if (!plain) return undefined;
  for (const guest of HUNT_GUESTS) {
    const stored = getHuntGuestPassword(guest);
    if (stored && verifyHuntPassword(plain, stored)) return guest;
  }
  return undefined;
}
