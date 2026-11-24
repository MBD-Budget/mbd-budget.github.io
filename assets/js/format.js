// Display formatting. Australian English, AUD.

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
const AUD0 = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const missing = (n) => n === null || n === undefined || Number.isNaN(n);

export const money = (n) => (missing(n) ? '–' : AUD.format(n));
export const money0 = (n) => (missing(n) ? '–' : AUD0.format(Math.round(n)));

// '2026-11-24' -> '24 Nov 2026'. Parsed by hand so a time zone can never move the day.
export function shortDate(iso) {
  if (!iso) return '–';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export const pct = (share) => `${Math.round(share * 100)}%`;

export function isoToday(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
