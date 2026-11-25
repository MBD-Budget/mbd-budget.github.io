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
        <span class="hbar-nums"><span class="num">${money0(r.amount)}</span> <span class="hbar-share">${r.percent === undefined ? pct(r.share) : `${r.percent}%`}</span></span>
      </div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(1.5, (r.amount / max) * 100).toFixed(1)}%"></div></div>
    </li>`).join('')}</ol>`;
}

// ---- Progress ring ----------------------------------------------------------------
let ringCount = 0;
export function ring({ share, centre, label, sublabel = '' }) {
  ringCount += 1;
  const r = 38;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.min(1, Math.max(0, share)));
  const id = `ring-grad-${ringCount}`;
  return `
  <div class="ring-wrap">
    <svg viewBox="0 0 100 100" class="ring-svg" role="img" aria-label="${esc(`${label}: ${centre}`)}">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#8bffec" /><stop offset="100%" stop-color="#A855F7" />
      </linearGradient></defs>
      <circle cx="50" cy="50" r="${r}" fill="none" stroke-width="8" stroke="rgba(128,128,128,0.18)" />
      <circle cx="50" cy="50" r="${r}" fill="none" stroke-width="8" stroke="url(#${id})"
        stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
        stroke-linecap="round" transform="rotate(-90 50 50)" />
      <text x="50" y="55" text-anchor="middle" class="ring-line1">${esc(centre)}</text>
    </svg>
    <span class="ring-label">${esc(label)}</span>
    ${sublabel ? `<span class="ring-sublabel">${esc(sublabel)}</span>` : ''}
  </div>`;
}

// ---- Line chart over time -----------------------------------------------------------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ms = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

function niceStep(max, ticks) {
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / pow;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * pow;
}
const shortMoney = (n) => (n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `$${Math.round(n)}`);

// lines:   [{ points: [{ date, amount }], dashed?: boolean, name }]
// targets: [{ amount, date?, label }]  drawn as dashed horizontal lines, with a marker at the date
export function lineChart(lines, { targets = [], summary = '' } = {}) {
  const points = lines.flatMap((l) => l.points);
  if (!points.length) return '<p class="hint">Nothing to chart yet.</p>';
  const W = 400; const H = 250; const left = 42; const right = 12; const top = 14; const bottom = 30;
  const dates = points.map((p) => ms(p.date)).concat(targets.filter((t) => t.date).map((t) => ms(t.date)));
  let x0 = Math.min(...dates); let x1 = Math.max(...dates);
  if (x1 === x0) { x0 -= 15 * 86400000; x1 += 15 * 86400000; }
  const top$ = Math.max(...points.map((p) => p.amount), ...targets.map((t) => t.amount), 1);
  const step = niceStep(top$ * 1.05, 4);
  const yMax = Math.ceil((top$ * 1.05) / step) * step;
  const x = (iso) => left + ((ms(iso) - x0) / (x1 - x0)) * (W - left - right);
  const y = (amount) => top + (1 - amount / yMax) * (H - top - bottom);

  let grid = '';
  for (let v = 0; v <= yMax + 0.001; v += step) {
    grid += `<line x1="${left}" x2="${W - right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="chart-grid" />
      <text x="${left - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" class="chart-axis">${shortMoney(v)}</text>`;
  }

  // Month labels: about five across, on the first of a month.
  const start = new Date(x0); const end = new Date(x1);
  const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  const every = Math.max(1, Math.ceil(months / 5));
  let labels = '';
  for (let i = 0; i <= months + 1; i += 1) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    if (d.getTime() < x0 || d.getTime() > x1 || i % every !== 0) continue;
    const px = left + ((d.getTime() - x0) / (x1 - x0)) * (W - left - right);
    if (px > W - right - 14) continue;
    labels += `<line x1="${px.toFixed(1)}" x2="${px.toFixed(1)}" y1="${H - bottom}" y2="${H - bottom + 4}" class="chart-grid" />
      <text x="${px.toFixed(1)}" y="${H - bottom + 16}" text-anchor="middle" class="chart-axis">${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}</text>`;
  }

  const targetLines = targets.map((t, i) => {
    const ty = y(t.amount).toFixed(1);
    const marker = t.date ? `<circle cx="${x(t.date).toFixed(1)}" cy="${ty}" r="3.5" class="chart-target-dot" />` : '';
    return `<line x1="${left}" x2="${W - right}" y1="${ty}" y2="${ty}" class="chart-target" />
      ${marker}
      <text x="${W - right - 2}" y="${(Number(ty) + (i % 2 ? 12 : -5)).toFixed(1)}" text-anchor="end" class="chart-target-label">${esc(t.label)}</text>`;
  }).join('');

  const drawn = lines.map((l) => {
    if (!l.points.length) return '';
    const path = l.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.amount).toFixed(1)}`).join(' ');
    const dots = l.dashed ? '' : l.points.map((p) => `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.amount).toFixed(1)}" r="3" class="chart-dot" />`).join('');
    return `<path d="${path}" class="chart-line${l.dashed ? ' dashed' : ''}" />${dots}`;
  }).join('');

  const legend = lines.filter((l) => l.points.length).map((l) =>
    `<span class="legend-item"><span class="legend-swatch${l.dashed ? ' dashed' : ''}"></span>${esc(l.name)}</span>`).join('')
    + (targets.length ? '<span class="legend-item"><span class="legend-swatch target"></span>Goal</span>' : '');

  return `
  <figure class="chart">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(summary)}" class="chart-svg">
      ${grid}${labels}${targetLines}${drawn}
    </svg>
    <figcaption class="chart-legend">${legend}</figcaption>
  </figure>`;
}
