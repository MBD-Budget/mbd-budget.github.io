// The Supabase client and the signed-in session. The only file that imports the client library.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/+esm';

const cfg = (typeof window !== 'undefined' && window.BUDGET_CONFIG) || {};

export const configured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_KEY);
export const db = configured ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY) : null;

export async function currentUser() {
  if (!db) return null;
  const { data } = await db.auth.getSession();
  return data.session ? data.session.user : null;
}

const EMAIL_KEY = 'mbd_user_email';
const networkError = (error) => Boolean(error) && (error instanceof TypeError
  || /fetch|network|load failed/i.test(String(error.message || '')) || (error.status >= 500 && error.status <= 599));

export function savedEmail() {
  try { return localStorage.getItem(EMAIL_KEY); } catch { return null; }
}

// 'in' with a user; 'out'; or 'unreachable' when a saved sign-in exists but the server can't be asked.
export async function sessionStatus() {
  if (!db) return { status: 'out', user: null };
  let result;
  try {
    result = await db.auth.getSession();
  } catch (error) {
    result = { data: { session: null }, error };
  }
  const user = result.data && result.data.session ? result.data.session.user : null;
  if (user) {
    try { localStorage.setItem(EMAIL_KEY, user.email || ''); } catch { /* ignore */ }
    return { status: 'in', user };
  }
  let email = null;
  try { email = localStorage.getItem(EMAIL_KEY); } catch { /* ignore */ }
  if (email !== null && (networkError(result.error) || (typeof navigator !== 'undefined' && navigator.onLine === false))) {
    return { status: 'unreachable', user: { email } };
  }
  return { status: 'out', user: null };
}

export async function signIn(email, password) {
  if (!db) throw new Error('The app has not been connected to its database yet.');
  const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
  if (!error) {
    try { localStorage.setItem(EMAIL_KEY, email.trim()); } catch { /* ignore */ }
    return;
  }
  if (/invalid login/i.test(error.message)) throw new Error('That email and password don\'t match.');
  if (networkError(error)) {
    throw new Error('Can\'t reach the database. Check your connection and try again. If it keeps happening, the database may be paused: open the Supabase dashboard and press Restore.');
  }
  throw new Error(error.message);
}

// scope 'local' so signing out on one phone doesn't sign the other person's phone out.
// If the server can't be reached the library may keep the saved sign-in, so remove it by hand.
export async function signOut() {
  try {
    if (db) await db.auth.signOut({ scope: 'local' });
  } catch { /* fall through to the manual clear */ }
  try {
    // Only this project's key: other sites on the same address may keep their own sign-ins here.
    const ref = new URL(cfg.SUPABASE_URL).hostname.split('.')[0];
    Object.keys(localStorage).filter((k) => k.startsWith(`sb-${ref}-auth-token`)).forEach((k) => localStorage.removeItem(k));
    localStorage.removeItem(EMAIL_KEY);
  } catch { /* ignore */ }
}

export async function changePassword(password) {
  if (!db) throw new Error('The app has not been connected to its database yet.');
  const { error } = await db.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}

export function onAuthChange(fn) {
  if (db) db.auth.onAuthStateChange((event) => fn(event));
}
