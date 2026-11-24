import { esc, money, money0 } from '../format.js';
import { categoryRows, costSummary, barData, fuelSummary } from '../compute.js';
import { hBars } from '../charts.js';
import { editBar, field, addRowButton, removeRowButton } from './shared.js';

const trimNumber = (n) => String(Math.round(n * 100) / 100);

function summaryCards(plan) {
  const s = costSummary(plan);
  return `
  <div class="stat-cards three">
    <div class="stat-card"><span class="stat-label">Income a month</span><span class="stat-value">${money0(s.income)}</span></div>
    <div class="stat-card"><span class="stat-label">Budget a month</span><span class="stat-value">${money0(s.budgetTotal)}</span></div>
    <div class="stat-card ${s.leftOver < 0 ? 'expense-card' : 'income-card'}"><span class="stat-label">Left over</span><span class="stat-value">${money0(s.leftOver)}</span></div>
  </div>`;
}

function chart(plan, ui) {
  const mode = ui.costMode === 'measured' ? 'measured' : 'budget';
  const button = (m, label) => `<button class="period-btn${mode === m ? ' active' : ''}" data-action="cost-mode" data-mode="${m}" aria-pressed="${mode === m}">${label}</button>`;
  return `
  <div class="section">
    <div class="section-header-row">
      <h2>Where the money goes</h2>
      <div class="period-toggle" role="group" aria-label="Which figures to chart">${button('budget', 'Budget')}${button('measured', 'Measured')}</div>
    </div>
    <p class="hint page-hint">${mode === 'budget' ? 'The plan for this period, a month.' : 'What we actually spent, averaged a month from bank statements.'} Largest first, with each one's share.</p>
    <div class="card">${hBars(barData(plan, mode))}</div>
  </div>`;
}

function table(plan) {
  const rows = categoryRows(plan);
  const s = costSummary(plan);
  return `
  <div class="section">
    <h2>Every category</h2>
    <p class="hint page-hint">Monthly figures. Measured is the average from bank statements; budget is the plan; six months is budget × 6.</p>
    <div class="card table-card">
      <table class="money-table">
        <thead><tr><th scope="col">Category</th><th scope="col">Measured</th><th scope="col">Budget</th><th scope="col">6 months</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
          <tr>
            <th scope="row"><span class="cell-name">${esc(r.name)}</span>${r.basis ? `<span class="cell-basis">${esc(r.basis)}</span>` : ''}</th>
            <td>${money0(r.measured)}</td><td>${money0(r.budget)}</td><td>${money0(r.sixMonth)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr><th scope="row">Total</th><td>${money0(s.measuredTotal)}</td><td>${money0(s.budgetTotal)}</td><td>${money0(s.budgetTotal * 6)}</td></tr></tfoot>
      </table>
    </div>
  </div>`;
}

function fuelRead(plan) {
  const f = fuelSummary(plan.fuel);
  return `
  <div class="section">
    <h2>Fuel calculator</h2>
    <p class="hint page-hint">Fuel at ${money(plan.fuel.pricePerLitre)} a litre. Each trip: return km × trips a week × litres per 100 km ÷ 100 × price.</p>
    <div class="card rows">
      ${f.trips.map((t) => `
      <div class="row">
        <div class="row-main">
          <span class="row-title">${esc(t.name)}</span>
          <span class="row-sub">${esc(t.car)}${t.car ? ' · ' : ''}${trimNumber(t.returnKm)} km return · ${trimNumber(t.tripsPerWeek)} a week · ${trimNumber(t.litresPer100)} L/100 km</span>
        </div>
        <div class="row-nums"><span class="num">${money(t.costPerWeek)}</span><span class="num-sub">a week</span></div>
      </div>`).join('')}
      <div class="row row-total">
        <div class="row-main"><span class="row-title">Total</span><span class="row-sub">${trimNumber(f.litresPerWeek)} litres a week</span></div>
        <div class="row-nums"><span class="num">${money(f.costPerWeek)} a week</span><span class="num-sub">${money(f.costPerMonth)} a month</span></div>
      </div>
    </div>
  </div>`;
}

function editView(plan, ui) {
  const f = fuelSummary(plan.fuel);
  const fuelAttrs = 'data-input="fuel"';
  const categories = plan.categories.map((cat, i) => `
    <div class="card edit-card">
      <div class="edit-line">
        <label class="lbl grow">Category ${field(ui, `categories.${i}.name`, cat.name, 'text')}</label>
        ${removeRowButton('categories', i, 'Remove this category')}
      </div>
      <div class="edit-line">
        <label class="lbl">Measured a month ${field(ui, `categories.${i}.measured`, cat.measured, 'moneyOrNull', { placeholder: '–' })}</label>
        ${cat.link === 'fuel'
          ? `<div class="lbl">Budget a month <span class="linked-value" data-out="fuel-month">${money(f.costPerMonth)}</span><span class="row-note">From the fuel calculator below</span></div>`
          : `<label class="lbl">Budget a month ${field(ui, `categories.${i}.budget`, cat.budget, 'moneyOrNull', { placeholder: '–' })}</label>`}
      </div>
      <label class="lbl">Basis ${field(ui, `categories.${i}.basis`, cat.basis, 'textOptional')}</label>
    </div>`).join('');

  const trips = plan.fuel.trips.map((t, i) => `
    <div class="card edit-card">
      <div class="edit-line">
        <label class="lbl grow">Trip ${field(ui, `fuel.trips.${i}.name`, t.name, 'text')}</label>
        <label class="lbl">Car ${field(ui, `fuel.trips.${i}.car`, t.car, 'textOptional')}</label>
        ${removeRowButton('fuel.trips', i, 'Remove this trip')}
      </div>
      <div class="edit-line">
        <label class="lbl narrow">Return km ${field(ui, `fuel.trips.${i}.returnKm`, t.returnKm, 'number', { attrs: fuelAttrs })}</label>
        <label class="lbl narrow">Trips a week ${field(ui, `fuel.trips.${i}.tripsPerWeek`, t.tripsPerWeek, 'number', { attrs: fuelAttrs })}</label>
        <label class="lbl narrow">L/100 km ${field(ui, `fuel.trips.${i}.litresPer100`, t.litresPer100, 'number', { attrs: fuelAttrs })}</label>
        <div class="lbl narrow">A week <span class="linked-value" data-out="trip-${i}">${money(f.trips[i].costPerWeek)}</span></div>
      </div>
    </div>`).join('');

  return `
  <div class="section">
    <h2>Fuel calculator</h2>
    <div class="card edit-card">
      <div class="edit-line">
        <label class="lbl narrow">Price a litre ${field(ui, 'fuel.pricePerLitre', plan.fuel.pricePerLitre, 'money', { attrs: fuelAttrs })}</label>
        <div class="lbl">Fuel a week <span class="linked-value" data-out="fuel-week">${money(f.costPerWeek)}</span></div>
        <div class="lbl">Fuel a month <span class="linked-value" data-out="fuel-month">${money(f.costPerMonth)}</span></div>
      </div>
    </div>
    ${trips}
    <div class="form-actions">${addRowButton('fuel.trips', 'Add a trip')}</div>
  </div>
  <div class="section">
    <h2>Categories</h2>
    ${categories}
    <div class="form-actions">${addRowButton('categories', 'Add a category')}</div>
  </div>`;
}

export function render(state, ui) {
  const plan = state.plan;
  return `
  <h1>Cost of living</h1>
  ${editBar(ui)}
  ${ui.editing ? editView(plan, ui) : summaryCards(plan) + chart(plan, ui) + table(plan) + fuelRead(plan)}`;
}

// Recalculate the fuel figures as someone types, without redrawing (which would lose their place).
function liveFuel({ parseMoney }) {
  const read = (path) => {
    const el = document.querySelector(`#app [data-path="${path}"]`);
    const n = el ? parseMoney(el.value) : null;
    return n === null ? 0 : n;
  };
  const count = document.querySelectorAll('#app [data-path^="fuel.trips."][data-path$=".returnKm"]').length;
  const fuel = {
    pricePerLitre: read('fuel.pricePerLitre'),
    trips: Array.from({ length: count }, (_, i) => ({
      returnKm: read(`fuel.trips.${i}.returnKm`),
      tripsPerWeek: read(`fuel.trips.${i}.tripsPerWeek`),
      litresPer100: read(`fuel.trips.${i}.litresPer100`),
    })),
  };
  const f = fuelSummary(fuel);
  const set = (key, value) => document.querySelectorAll(`#app [data-out="${key}"]`).forEach((el) => { el.textContent = value; });
  set('fuel-week', money(f.costPerWeek));
  set('fuel-month', money(f.costPerMonth));
  f.trips.forEach((t, i) => set(`trip-${i}`, money(t.costPerWeek)));
}

export const actions = {
  'cost-mode': ({ el, ui, paint }) => { ui.costMode = el.dataset.mode; paint(); },
  'input:fuel': liveFuel,
};
