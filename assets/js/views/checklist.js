import { esc, money, shortDate } from '../format.js';
import { checklistGroups, checklistProgress } from '../compute.js';
import { confirmButton } from './shared.js';

function progressCard(p) {
  const share = p.total ? p.done / p.total : 0;
  return `
  <div class="card progress-card${p.total && p.done === p.total ? ' done' : ''}">
    <div class="progress-top">
      <div>
        <span class="stat-label">Transfers done</span>
        <span class="progress-count"><strong>${p.done}</strong> of ${p.total}</span>
      </div>
      <div class="progress-right">
        <span class="stat-label">House deposit this fortnight</span>
        <span class="progress-count"><strong>${money(p.depositTransferred)}</strong></span>
      </div>
    </div>
    <div class="prog-track" role="progressbar" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.done}" aria-label="Transfers done">
      <div class="prog-bar" style="width:${Math.round(share * 100)}%"></div>
    </div>
  </div>`;
}

function group(g, state, ui) {
  const src = g.source;
  const landedKnown = state.landed !== null && state.landed !== undefined;
  const rows = g.rows.map((r) => {
    const locked = (!r.tickable && !r.ticked) || ui.offline;
    const amount = r.isEstimate ? `about ${money(r.amount)}` : money(r.amount);
    return `
    <button class="tick-row${r.ticked ? ' ticked' : ''}" role="checkbox" aria-checked="${r.ticked}" data-action="tick" data-id="${esc(r.transfer.id)}"${locked ? ' disabled' : ''}>
      <span class="tick-box" aria-hidden="true">${r.ticked ? '✓' : ''}</span>
      <span class="tick-main">
        <span class="tick-to">${esc(r.toName)}</span>
        <span class="tick-from">from ${esc(r.fromName)}${r.transfer.rule === 'remainder' ? ' · the rest of this pay' : ''}</span>
        ${!r.tickable && !r.ticked ? '<span class="tick-hint">Enter the amount that landed first</span>' : ''}
      </span>
      <span class="tick-amount">${amount}</span>
    </button>`;
  }).join('');

  const landed = g.hasRemainder ? `
    <div class="landed">
      <label class="lbl" for="landed-input">Amount that landed</label>
      <div class="landed-line">
        <input id="landed-input" class="form-input${ui.landedError ? ' invalid' : ''}" type="text" inputmode="decimal" autocomplete="off"
          data-input="landed" value="${landedKnown ? esc(state.landed) : ''}" placeholder="${esc(money(src.takeHome))} estimated"${ui.offline ? ' disabled' : ''} />
        <button class="small-btn" data-action="landed-save"${ui.offline ? ' disabled' : ''}>Set</button>
      </div>
      ${ui.landedError ? `<span class="field-error">${esc(ui.landedError)}</span>` : ''}
    </div>` : '';

  const stays = g.stays.map((s) => `
    <div class="stays-note"><span>Stays in ${esc(s.accountName)} for bills</span><span class="num">${money(s.amount)}</span></div>`).join('');

  const payAmount = g.hasRemainder
    ? (landedKnown ? money(state.landed) : `about ${money(src.takeHome)}`)
    : money(src.takeHome);

  return `
  <div class="section pay-group">
    <div class="pay-head">
      <div>
        <h2>${esc(g.personName)}'s ${esc(src.name)} pay</h2>
        <span class="row-sub">${esc(src.payday)}, week ${esc(src.weekOfFortnight)} · ${payAmount}</span>
      </div>
      <span class="tag${g.rows.length && g.done === g.rows.length ? ' tag-done' : ''}">${g.done} of ${g.rows.length}</span>
    </div>
    ${landed}
    <div class="card tick-list">${rows}${stays}</div>
  </div>`;
}

function history(list) {
  if (!list.length) return '<div class="card"><p class="hint">No past fortnights yet. They appear here after the first reset.</p></div>';
  return `<div class="card rows">${list.map((h) => `
    <div class="row">
      <div class="row-main">
        <span class="row-title">${shortDate(h.closedOn)}</span>
        <span class="row-sub">${h.transfersDone} of ${h.transfersTotal} transfers done</span>
      </div>
      <div class="row-nums"><span class="num">${money(h.depositTransferred)}</span><span class="num-sub">to the deposit</span></div>
    </div>`).join('')}</div>`;
}

export function render(state, ui) {
  const plan = state.plan;
  const progress = checklistProgress(plan, state.ticks, state.landed);
  const groups = checklistGroups(plan, state.ticks, state.landed);
  return `
  <h1>Checklist</h1>
  ${state.startedOn ? `<p class="hint centre">This fortnight started ${shortDate(state.startedOn)}</p>` : ''}
  ${progressCard(progress)}
  ${groups.map((g) => group(g, state, ui)).join('')}

  <div class="section reset-section">
    <div class="card">
      <p class="hint">When the fortnight is finished, reset. It saves this fortnight to the history below and clears every tick, on both phones.</p>
      <div class="form-actions">
        ${ui.offline ? '' : confirmButton(ui, {
          action: 'fortnight-reset', label: 'Reset for next fortnight', confirmLabel: 'Yes, save and reset',
          cls: 'primary', disabled: progress.done === 0,
        })}
      </div>
      ${progress.done === 0 ? '<p class="hint">Nothing is ticked yet, so there is nothing to save.</p>' : ''}
    </div>
  </div>

  <div class="section">
    <h2>Past fortnights</h2>
    ${history(state.history)}
  </div>`;
}

async function tick({ el, state, store, paint, refresh, toast }) {
  const id = el.dataset.id;
  const on = !state.ticks.includes(id);
  // Show it straight away, then tell the database. If that fails, put it back.
  state.ticks = on ? [...state.ticks, id] : state.ticks.filter((t) => t !== id);
  paint();
  const again = document.querySelector(`#app [data-action="tick"][data-id="${CSS.escape(id)}"]`);
  if (again) again.focus({ preventScroll: true });
  try {
    await store.setTick(id, on);
  } catch (error) {
    toast(error.message);
    await refresh();
  }
}

async function saveLanded({ state, ui, store, act, paint, parseMoney }) {
  const input = document.getElementById('landed-input');
  if (!input) return;
  const text = input.value.trim();
  const amount = text === '' ? null : parseMoney(text);
  if (text !== '' && amount === null) {
    ui.landedError = 'Enter an amount, like 1600 or 1,714.50.';
    input.blur();
    paint();
    return;
  }
  ui.landedError = '';
  if (amount === state.landed) { input.blur(); paint(); return; }
  input.blur();
  await act(() => store.setLanded(amount));
}

export const actions = {
  tick,
  'landed-save': saveLanded,
  'change:landed': saveLanded,
  'fortnight-reset': ({ ui, store, act, toast }) => act(async () => {
    const saved = await store.closeFortnight();
    ui.armed = null;
    toast(saved ? 'Fortnight saved. Ticks cleared.' : 'Already reset');
  }),
};
