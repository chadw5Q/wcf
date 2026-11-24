import type { APIRoute } from 'astro';
import { ADMIN_SESSION_COOKIE } from '../../../lib/auth';

export const prerender = false;

/** Clears the admin session and sends the browser to the admin login page. */
export const POST: APIRoute = async ({ cookies, redirect }) => {
  cookies.delete(ADMIN_SESSION_COOKIE, { path: '/' });
  // 303 so the browser follows with a GET instead of re-posting.
  return redirect('/admin/login', 303);
};
