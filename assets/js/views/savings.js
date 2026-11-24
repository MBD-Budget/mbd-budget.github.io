import { esc, money, money0, shortDate, pct } from '../format.js';
import { savingsSeries, accountSeries, goalProgress, ingCheck, depositAccount, emergencyAccount } from '../compute.js';
import { ring, lineChart } from '../charts.js';
import { editBar, field, addRowButton, removeRowButton, confirmButton } from './shared.js';

function goalCard(plan, saved, today) {
  const goals = plan.goals || [];
  if (!goals.length) return '<div class="card"><p class="hint">No goal set yet. Use Edit figures to add one.</p></div>';
  const perFortnight = plan.savings.perFortnight;
  const [first, ...rest] = goals;
  const g = goalProgress(first, saved, today, perFortnight);
  const needed = g.neededPerFortnight === null ? '–' : money0(g.neededPerFortnight);
  const status = g.remaining === 0
    ? '<span class="tag tag-done">Goal reached</span>'
    : g.neededPerFortnight === null
      ? '<span class="tag tag-warn">Target date has passed</span>'
      : g.onTrack
        ? '<span class="tag tag-done">On track</span>'
        : '<span class="tag tag-warn">Behind the plan</span>';
  const others = rest.map((goal) => {
    const o = goalProgress(goal, saved, today, perFortnight);
    return `
    <div class="row">
      <div class="row-main grow">
        <span class="row-title">${esc(goal.name)}</span>
        <span class="row-sub">${money0(goal.target)} by ${shortDate(goal.targetDate)} · ${o.fortnightsLeft} fortnights left · ${o.neededPerFortnight === null ? '–' : money0(o.neededPerFortnight)} a fortnight needed</span>
        <div class="prog-track"><div class="prog-bar" style="width:${Math.round(o.pct * 100)}%"></div></div>
      </div>
      <div class="row-nums"><span class="num">${pct(o.pct)}</span></div>
    </div>`;
  }).join('');
  return `
  <div class="card goal-hero">
    ${ring({ share: g.pct, centre: pct(g.pct), label: first.name })}
    <div class="goal-facts">
      <div class="goal-saved"><strong>${money(saved)}</strong> saved of ${money0(first.target)}</div>
      <div class="row-sub">By ${shortDate(first.targetDate)}</div>
      <dl class="facts">
        <div><dt>Fortnights left</dt><dd>${g.fortnightsLeft}</dd></div>
        <div><dt>Needed a fortnight</dt><dd>${needed}</dd></div>
        <div><dt>Planned a fortnight</dt><dd>${money0(perFortnight)}</dd></div>
      </dl>
      ${status}
    </div>
  </div>
  ${others ? `<div class="card rows">${others}</div>` : ''}`;
}

function ingPanel(plan, state, today) {
  const account = depositAccount(plan);
  const check = ingCheck(plan, state.balances, state.history, today);
  const name = account ? account.name : 'The deposit account';
  let body;
  let cls = '';
  if (check.ok === null) {
    cls = 'warn';
    body = `<strong>Can't check this month yet.</strong> Log last month's closing balance for ${esc(name)} below and this panel will tell you where you stand.`;
  } else if (check.ok) {
    cls = 'ok';
    body = `<strong>On track for the bonus rate.</strong> ${esc(name)} is at ${money(check.current)}, above last month's close of ${money(check.previousMonthEnd)}. Keep it there until ${shortDate(check.deadline)}.`;
  } else {
    cls = 'err';
    body = `<strong>This month would miss the bonus rate.</strong> ${esc(name)} is at ${money(check.current)} and last month closed at ${money(check.previousMonthEnd)}. It needs more than ${money(check.shortfall)} more by ${shortDate(check.deadline)}.`;
  }
  return `
  <div class="section">
    <h2>Bonus interest check</h2>
    <div class="banner ${cls} plain" role="status">${body}</div>
    <p class="hint">ING pays bonus interest only when ${esc(name)} ends each calendar month higher than the month before, not counting interest. Money goes in only.</p>
  </div>`;
}

function charts(plan, state, today) {
  const series = savingsSeries(plan, state.balances, state.history, today);
  const targets = (plan.goals || []).map((g) => ({ amount: g.target, date: g.targetDate, label: `${g.name} · ${money0(g.target)}` }));
  // Stop drawing the projection once it passes the biggest goal, so the goals stay readable.
  const biggest = Math.max(0, ...targets.map((t) => t.amount));
  const reached = series.projection.findIndex((p) => p.amount >= biggest);
  const projection = biggest && reached !== -1 ? series.projection.slice(0, reached + 1) : series.projection;
  const emergency = emergencyAccount(plan);
  const emergencyPoints = emergency ? accountSeries(state.balances, emergency.id) : [];
  const latestEmergency = emergencyPoints.length ? emergencyPoints[emergencyPoints.length - 1] : null;
  return `
  <div class="section">
    <h2>Savings over time</h2>
    <p class="hint page-hint">Logged balances, then a projection at ${money0(plan.savings.perFortnight)} a fortnight from today.</p>
    <div class="card">${lineChart([
      { name: 'Saved so far', points: series.actual },
      { name: 'Projection', points: projection, dashed: true },
    ], { targets, summary: `Savings over time. Saved so far ${money0(series.saved)}.` })}</div>
  </div>
  <div class="section">
    <h2>Emergency fund</h2>
    ${emergency ? `<p class="hint page-hint">${esc(emergency.name)}${latestEmergency ? `: ${money(latestEmergency.amount)} on ${shortDate(latestEmergency.date)}` : ''}</p>` : ''}
    <div class="card">${emergencyPoints.length
      ? lineChart([{ name: 'Balance', points: emergencyPoints }], { summary: 'Emergency fund balance over time.' })
      : '<p class="hint">No balance logged yet. Log one below to start this chart.</p>'}</div>
  </div>`;
}

function balanceForm(plan, state, ui, today) {
  const accounts = plan.accounts.filter((a) => a.role !== 'none');
  const names = new Map(plan.accounts.map((a) => [a.id, a.name]));
  const entries = [...state.balances].reverse().map((b) => `
    <div class="row">
      <div class="row-main">
        <span class="row-title">${shortDate(b.onDate)}</span>
        <span class="row-sub">${esc(names.get(b.accountId) || 'Removed account')}</span>
      </div>
      <div class="row-nums row-nums-inline">
        <span class="num">${money(b.balance)}</span>
        ${ui.offline ? '' : confirmButton(ui, { action: 'balance-delete', key: `balance-${b.id}`, label: 'Delete', confirmLabel: 'Yes, delete', attrs: `data-id="${esc(b.id)}"` })}
      </div>
    </div>`).join('');
  return `
  <div class="section">
    <h2>Log a balance</h2>
    <p class="hint page-hint">Type in what the bank shows. Logging the same account and date again replaces that entry.</p>
    ${ui.offline ? '' : `
    <form class="card edit-card" data-form="balance" novalidate>
      <div class="edit-line">
        <label class="lbl">Date <input class="form-input" type="date" name="onDate" value="${esc(ui.balanceDraft?.onDate || today)}" max="${esc(today)}" required /></label>
        <label class="lbl">Account
          <select class="form-input" name="accountId">${accounts.map((a) => `<option value="${esc(a.id)}"${ui.balanceDraft?.accountId === a.id ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
        </label>
      </div>
      <label class="lbl">Balance
        <input class="form-input${ui.balanceError ? ' invalid' : ''}" type="text" inputmode="decimal" name="balance" autocomplete="off" value="${esc(ui.balanceDraft?.balance || '')}" />
        ${ui.balanceError ? `<span class="field-error">${esc(ui.balanceError)}</span>` : ''}
      </label>
      <div class="form-actions"><button class="primary small-btn" type="submit"${ui.busy ? ' disabled' : ''}>Log balance</button></div>
    </form>`}
    ${entries ? `<div class="card rows">${entries}</div>` : '<div class="card"><p class="hint">No balances logged yet.</p></div>'}
  </div>`;
}

function editView(plan, ui) {
  const goals = (plan.goals || []).map((g, i) => `
    <div class="card edit-card">
      <div class="edit-line">
        <label class="lbl grow">Goal ${field(ui, `goals.${i}.name`, g.name, 'text')}</label>
        ${removeRowButton('goals', i, 'Remove this goal')}
      </div>
      <div class="edit-line">
        <label class="lbl">Target amount ${field(ui, `goals.${i}.target`, g.target, 'money')}</label>
        <label class="lbl">Target date ${field(ui, `goals.${i}.targetDate`, g.targetDate, 'date')}</label>
      </div>
    </div>`).join('');
  return `
  <div class="section">
    <h2>Goals</h2>
    <p class="hint page-hint">The first goal drives the ring and "needed a fortnight". Every goal is drawn as a line on the chart.</p>
    ${goals}
    <div class="form-actions">${addRowButton('goals', 'Add a goal')}</div>
  </div>
  <div class="section">
    <h2>Projection</h2>
    <div class="card edit-card">
      <label class="lbl">Planned saving a fortnight ${field(ui, 'savings.perFortnight', plan.savings.perFortnight, 'money', { width: 'sm' })}</label>
    </div>
  </div>`;
}

export function render(state, ui) {
  const plan = state.plan;
  const today = state.today;
  if (ui.editing) return `<h1>Savings</h1>${editBar(ui)}${editView(plan, ui)}`;
  const { saved } = savingsSeries(plan, state.balances, state.history, today);
  return `
  <h1>Savings</h1>
  ${editBar(ui, { label: 'Edit goals' })}
  ${goalCard(plan, saved, today)}
  ${ingPanel(plan, state, today)}
  ${charts(plan, state, today)}
  ${balanceForm(plan, state, ui, today)}`;
}

export const actions = {
  'submit:balance': async ({ form, state, ui, store, act, paint, toast, parseMoney }) => {
    const onDate = form.elements.onDate.value;
    const accountId = form.elements.accountId.value;
    const text = form.elements.balance.value;
    const balance = parseMoney(text);
    ui.balanceDraft = { onDate, accountId, balance: text };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(onDate)) { ui.balanceError = 'Choose a date.'; return paint(); }
    if (onDate > state.today) { ui.balanceError = 'The date can\'t be in the future.'; return paint(); }
    if (balance === null) { ui.balanceError = 'Enter the balance, like 5069.23.'; return paint(); }
    ui.balanceError = '';
    return act(async () => {
      await store.addBalance({ accountId, onDate, balance });
      ui.balanceDraft = { accountId };
      toast('Balance logged');
    });
  },
  'balance-delete': ({ el, ui, store, act, toast }) => act(async () => {
    await store.deleteBalance(Number(el.dataset.id));
    ui.armed = null;
    toast('Entry deleted');
  }),
};
