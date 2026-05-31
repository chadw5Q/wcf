import type { APIRoute } from 'astro';
import { HUNT_SESSION_COOKIE } from '../../lib/hunt-auth';

export const prerender = false;

/** Clears hunt session and sends the browser to the hunt login page. */
export const GET: APIRoute = async ({ cookies, redirect }) => {
  cookies.delete(HUNT_SESSION_COOKIE, { path: '/hunt' });
  return redirect('/hunt/login', 302);
};
