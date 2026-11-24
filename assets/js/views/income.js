import { esc, money, shortDate } from '../format.js';
import { incomeSummary } from '../compute.js';
import { editBar, field, choice, tickbox, addRowButton, removeRowButton } from './shared.js';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => ({ id: d, name: d }));
const WEEKS = [{ id: 1, name: 'Week 1' }, { id: 2, name: 'Week 2' }];

function readView(plan) {
  const s = incomeSummary(plan);
  const sources = s.sources.map((src) => `
    <div class="row">
      <div class="row-main">
        <span class="row-title">${esc(src.name)} ${src.isEstimate ? '<span class="tag tag-warn">Estimate</span>' : ''}</span>
        <span class="row-sub">${esc(src.personName)} · ${esc(src.payday)}, week ${esc(src.weekOfFortnight)}</span>
        ${src.note ? `<span class="row-note">${esc(src.note)}</span>` : ''}
      </div>
      <div class="row-nums">
        <span class="num">${money(src.takeHome)}</span>
        <span class="num-sub">${money(src.monthly)} a month</span>
      </div>
    </div>`).join('');

  const sacrifices = s.sources.flatMap((src) => src.sacrifices.map((sac) => `
    <div class="row">
      <div class="row-main">
        <span class="row-title">${esc(sac.label)}</span>
        <span class="row-sub">${esc(src.personName)} · ${esc(src.name)}</span>
      </div>
      <div class="row-nums"><span class="num">${money(sac.amount)}</span></div>
    </div>`)).join('');

  const gross = s.sources.map((src) => `
    <div class="row">
      <div class="row-main">
        <span class="row-title">${esc(src.name)}</span>
        <span class="row-sub">${esc(src.personName)}</span>
      </div>
      <div class="row-nums">
        <span class="num">${money(src.gross)}</span>
        <span class="num-sub">${src.grossAnnual === null ? '–' : `${money(src.grossAnnual)} a year`}</span>
      </div>
    </div>`).join('');

  const people = new Map(plan.people.map((p) => [p.id, p.name]));
  const loans = (plan.loans || []).map((l) => `
    <div class="row">
      <div class="row-main">
        <span class="row-title">${esc(l.name)}</span>
        <span class="row-sub">${esc(people.get(l.personId) || '')}${l.asAt ? ` · as at ${shortDate(l.asAt)}` : ''}</span>
      </div>
      <div class="row-nums"><span class="num">${l.balance === null || l.balance === undefined ? 'To be added' : money(l.balance)}</span></div>
    </div>`).join('');

  return `
  <div class="stat-cards two">
    <div class="stat-card"><span class="stat-label">Take-home a fortnight</span><span class="stat-value">${money(s.takeHomeFortnight)}</span></div>
    <div class="stat-card"><span class="stat-label">Take-home a month</span><span class="stat-value">${money(s.takeHomeMonthly)}</span></div>
  </div>

  <div class="section">
    <h2>Take-home pay</h2>
    <p class="hint page-hint">What lands in the bank each fortnight. A month is a fortnight × 26 ÷ 12.</p>
    <div class="card rows">
      ${sources}
      <div class="row row-total">
        <div class="row-main"><span class="row-title">Total</span></div>
        <div class="row-nums"><span class="num">${money(s.takeHomeFortnight)}</span><span class="num-sub">${money(s.takeHomeMonthly)} a month</span></div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Salary sacrificed before tax</h2>
    <p class="hint page-hint">Paid before tax each fortnight, so it is not included in take-home pay.</p>
    <div class="card rows">
      ${sacrifices || '<div class="row"><span class="hint">Nothing salary sacrificed.</span></div>'}
      <div class="row row-total">
        <div class="row-main"><span class="row-title">Total</span></div>
        <div class="row-nums"><span class="num">${money(s.sacrificeFortnight)}</span></div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Gross pay</h2>
    <p class="hint page-hint">Before tax and salary sacrifice, each fortnight and over a year.</p>
    <div class="card rows">
      ${gross}
      <div class="row row-total">
        <div class="row-main"><span class="row-title">Total</span></div>
        <div class="row-nums"><span class="num">${money(s.grossFortnight)}</span><span class="num-sub">${money(s.grossAnnual)} a year</span></div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Study loans</h2>
    <div class="card rows">
      ${loans || '<div class="row"><span class="hint">No loans listed.</span></div>'}
      <div class="row row-total">
        <div class="row-main"><span class="row-title">Total owing</span></div>
        <div class="row-nums"><span class="num">${money(s.loansTotal)}</span></div>
      </div>
    </div>
  </div>`;
}

function editView(plan, ui) {
  const people = plan.people;
  const sources = plan.incomeSources.map((src, i) => {
    const p = `incomeSources.${i}`;
    const sacrifices = (src.sacrifices || []).map((sac, j) => `
      <div class="edit-line">
        <label class="lbl grow">What it is ${field(ui, `${p}.sacrifices.${j}.label`, sac.label, 'text')}</label>
        <label class="lbl">A fortnight ${field(ui, `${p}.sacrifices.${j}.amount`, sac.amount, 'money', { width: 'sm' })}</label>
        ${removeRowButton(`${p}.sacrifices`, j, 'Remove this salary sacrifice')}
      </div>`).join('');
    return `
    <div class="card edit-card">
      <div class="edit-line">
        <label class="lbl grow">Name ${field(ui, `${p}.name`, src.name, 'text')}</label>
        <label class="lbl">Who ${choice(ui, `${p}.personId`, src.personId, people)}</label>
        ${removeRowButton('incomeSources', i, 'Remove this pay')}
      </div>
      <div class="edit-line">
        <label class="lbl">Take-home a fortnight ${field(ui, `${p}.takeHome`, src.takeHome, 'money')}</label>
        <label class="lbl">Gross a fortnight ${field(ui, `${p}.gross`, src.gross, 'moneyOrNull')}</label>
      </div>
      <div class="edit-line">
        <label class="lbl">Payday ${choice(ui, `${p}.payday`, src.payday, WEEKDAYS)}</label>
        <label class="lbl">Which week ${choice(ui, `${p}.weekOfFortnight`, src.weekOfFortnight, WEEKS, { type: 'choiceInt' })}</label>
      </div>
      <label class="lbl">Note ${field(ui, `${p}.note`, src.note, 'textOptional')}</label>
      ${tickbox(ui, `${p}.isEstimate`, src.isEstimate, 'This pay varies, so the take-home figure is an estimate')}
      <h3 class="form-title sub">Salary sacrificed before tax</h3>
      ${sacrifices || '<p class="hint">None.</p>'}
      <div class="form-actions">${addRowButton(`${p}.sacrifices`, 'Add salary sacrifice')}</div>
    </div>`;
  }).join('');

  const loans = (plan.loans || []).map((l, i) => `
    <div class="card edit-card">
      <div class="edit-line">
        <label class="lbl grow">Loan ${field(ui, `loans.${i}.name`, l.name, 'text')}</label>
        <label class="lbl">Who ${choice(ui, `loans.${i}.personId`, l.personId, people)}</label>
        ${removeRowButton('loans', i, 'Remove this loan')}
      </div>
      <div class="edit-line">
        <label class="lbl">Balance ${field(ui, `loans.${i}.balance`, l.balance, 'moneyOrNull', { placeholder: 'To be added' })}</label>
        <label class="lbl">As at ${field(ui, `loans.${i}.asAt`, l.asAt, 'dateOrNull')}</label>
      </div>
    </div>`).join('');

  return `
  <div class="section">
    <h2>Pay</h2>
    ${sources}
    <div class="form-actions">${addRowButton('incomeSources', 'Add a pay')}</div>
    <p class="hint">A new pay has no transfers yet. Add them under Settings → The plan.</p>
  </div>
  <div class="section">
    <h2>Study loans</h2>
    ${loans}
    <div class="form-actions">${addRowButton('loans', 'Add a loan')}</div>
  </div>`;
}

export function render(state, ui) {
  return `
  <h1>Income</h1>
  ${editBar(ui)}
  ${ui.editing ? editView(state.plan, ui) : readView(state.plan)}`;
}
