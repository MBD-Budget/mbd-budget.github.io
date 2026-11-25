import { esc, money, money0, shortDate, pct } from '../format.js';
import { savingsSeries, accountSeries, goalProgress, countFrom, depositAccount, emergencyAccount, debtSummary, addDays } from '../compute.js';
import { ring, lineChart } from '../charts.js';
import { editBar, field, addRowButton, removeRowButton, confirmButton } from './shared.js';

function goalCard(plan, saved, today, hasData) {
  const goals = plan.goals || [];
  if (!goals.length) return '<div class="card"><p class="hint">No goal set yet. Use Edit figures to add one.</p></div>';
  const perFortnight = plan.savings.perFortnight;
  const owing = debtSummary(plan).total;
  const [first, ...rest] = goals;
  const from = countFrom(plan, today);
  const g = goalProgress(first, saved, today, perFortnight, owing, from);
  const needed = g.neededPerFortnight === null ? '–' : money0(g.neededPerFortnight);
  const status = g.remaining === 0
    ? '<span class="tag tag-done">Goal reached</span>'
    : g.neededPerFortnight === null
      ? '<span class="tag tag-warn">Target date has passed</span>'
      : g.onTrack
        ? '<span class="tag tag-done">On track</span>'
        : '<span class="tag tag-warn">Behind the plan</span>';
  const others = rest.map((goal) => {
    const o = goalProgress(goal, saved, today, perFortnight, owing, from);
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
      <div class="goal-saved">${hasData
        ? `<strong>${money(saved)}</strong> saved of ${money0(first.target)}`
        : `<strong>No balance logged yet.</strong> Log what ${esc((depositAccount(plan) || {}).name || 'the deposit account')} shows, below, to start counting towards ${money0(first.target)}.`}</div>
      <div class="row-sub">By ${shortDate(first.targetDate)}</div>
      <dl class="facts">
        <div><dt>Fortnights left</dt><dd>${g.fortnightsLeft}</dd></div>
        <div><dt>Needed a fortnight${owing > 0 ? ', debts included' : ''}</dt><dd>${needed}</dd></div>
        <div><dt>Planned a fortnight</dt><dd>${money0(perFortnight)}</dd></div>
      </dl>
      ${status}
    </div>
  </div>
  ${others ? `<div class="card rows">${others}</div>` : ''}`;
}

function debtPanel(plan, today) {
  const d = debtSummary(plan);
  if (!d.debts.length) return '';
  const rows = d.debts.map((debt, i) => `
    <div class="row">
      <div class="row-main">
        <span class="row-title">${esc(debt.name)}</span>
        <span class="row-sub">${debt.owing > 0 ? (i === d.debts.findIndex((x) => x.owing > 0) ? 'Pay this one first' : 'Next in line') : 'Cleared'}</span>
      </div>
      <div class="row-nums"><span class="num">${debt.owing > 0 ? money(debt.owing) : '✓'}</span></div>
    </div>`).join('');
  let plain;
  if (d.total === 0) {
    plain = '<strong>All debts cleared.</strong> Everything sent to the house deposit now counts as saved.';
  } else if (d.fortnightsToClear === null) {
    plain = `<strong>${money(d.total)} to clear before saving starts.</strong> Set a planned saving a fortnight under Edit goals to see how long it takes.`;
  } else {
    const n = d.fortnightsToClear;
    plain = `<strong>${money(d.total)} to clear before saving starts.</strong> At ${money0(d.perFortnight)} a fortnight that takes ${n} fortnight${n === 1 ? '' : 's'}, to about ${shortDate(addDays(countFrom(plan, today), n * 14))}.${d.savedInLastFortnight > 0 ? ` The last of those still leaves ${money0(d.savedInLastFortnight)} for the deposit.` : ''}`;
  }
  return `
  <div class="section">
    <h2>Debts to clear first</h2>
    <div class="banner ${d.total === 0 ? 'ok' : 'warn'} plain block" role="status"><span>${plain}</span></div>
    <div class="card rows">
      ${rows}
      <div class="row row-total">
        <div class="row-main"><span class="row-title">Still owing</span></div>
        <div class="row-nums"><span class="num">${money(d.total)}</span></div>
      </div>
    </div>
    <p class="hint">House-deposit transfers on the checklist go to these, in this order, until they are cleared. Each reset takes what was paid off the amounts here.</p>
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
    <p class="hint page-hint">Logged balances, then a projection at ${money0(plan.savings.perFortnight)} a fortnight from ${series.from > today ? shortDate(series.from) : 'today'}${debtSummary(plan).total > 0 ? ', flat until the debts are cleared' : ''}.</p>
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
    <h2>Debts to clear first</h2>
    <p class="hint page-hint">Paid from the house-deposit money, in this order, before anything counts as saved. Put the one to pay first at the top. "Still owing" goes down by itself at each reset, and you can correct it here any time.</p>
    ${(plan.debts || []).map((debt, i) => `
    <div class="card edit-card">
      <div class="edit-line">
        <label class="lbl grow">Debt ${field(ui, `debts.${i}.name`, debt.name, 'text')}</label>
        <label class="lbl narrow">Still owing ${field(ui, `debts.${i}.owing`, debt.owing, 'money')}</label>
        ${removeRowButton('debts', i, 'Remove this debt')}
      </div>
    </div>`).join('') || '<p class="hint">No debts listed.</p>'}
    <div class="form-actions">${addRowButton('debts', 'Add a debt')}</div>
  </div>
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
  const { saved, hasData } = savingsSeries(plan, state.balances, state.history, today);
  return `
  <h1>Savings</h1>
  ${editBar(ui, { label: 'Edit goals' })}
  ${debtPanel(plan, today)}
  ${goalCard(plan, saved, today, hasData)}
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
    if (balance === null) { ui.balanceError = 'Enter the balance, like 1234.56.'; return paint(); }
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
