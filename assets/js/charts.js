// Charts, drawn by hand in the app's own style. Each returns a string of HTML or SVG.
import { esc, money0, pct } from './format.js';

// Horizontal bars, already sorted by the caller. rows: [{ name, amount, share }]
export function hBars(rows) {
  if (!rows.length) return '<p class="hint">Nothing to show yet.</p>';
  const max = rows[0].amount;
  return `<ol class="hbars">${rows.map((r) => `
    <li class="hbar">
      <div class="hbar-head">
        <span class="hbar-name">${esc(r.name)}</span>
        <span class="hbar-nums"><span class="num">${money0(r.amount)}</span> <span class="hbar-share">${pct(r.share)}</span></span>
      </div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(1.5, (r.amount / max) * 100).toFixed(1)}%"></div></div>
    </li>`).join('')}</ol>`;
}
