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

export async function signIn(email, password) {
  if (!db) throw new Error('The app has not been connected to its database yet.');
  const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
  if (!error) return;
  if (/invalid login/i.test(error.message)) throw new Error('That email and password don\'t match.');
  if (error instanceof TypeError || /fetch|network|load failed/i.test(error.message)) {
    throw new Error('Can\'t reach the database. Check your connection and try again.');
  }
  throw new Error(error.message);
}

// scope 'local' so signing out on one phone doesn't sign the other person's phone out.
export async function signOut() {
  if (db) await db.auth.signOut({ scope: 'local' });
}

export async function changePassword(password) {
  if (!db) throw new Error('The app has not been connected to its database yet.');
  const { error } = await db.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}

export function onAuthChange(fn) {
  if (db) db.auth.onAuthStateChange((event) => fn(event));
}
