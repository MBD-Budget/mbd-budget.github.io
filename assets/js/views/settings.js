import { esc } from '../format.js';
import { passwordProblem } from '../plan.js';
import { changePassword } from '../auth.js';
import { confirmButton, editBar, field, choice, addRowButton, removeRowButton } from './shared.js';

const ROLES = [
  { id: 'none', name: 'Ordinary account' },
  { id: 'deposit', name: 'House deposit' },
  { id: 'emergency', name: 'Emergency fund' },
];
const RULES = [
  { id: 'fixed', name: 'A set amount' },
  { id: 'remainder', name: 'The rest of this pay' },
  { id: 'stays', name: 'Stays where it landed (a note, no tick)' },
];

function planRead(plan) {
  const count = plan.transfers.filter((t) => t.rule !== 'stays').length;
  return `
  <div class="card rows">
    <div class="row"><div class="row-main"><span class="row-title">Budget period</span><span class="row-sub">${esc(plan.period.label || '')}</span></div></div>
    <div class="row"><div class="row-main"><span class="row-title">People</span><span class="row-sub">${esc(plan.people.map((p) => p.name).join(' and '))}</span></div></div>
    <div class="row"><div class="row-main"><span class="row-title">Accounts</span><span class="row-sub">${plan.accounts.length} accounts</span></div></div>
    <div class="row"><div class="row-main"><span class="row-title">Payday transfers</span><span class="row-sub">${count} transfers each fortnight</span></div></div>
  </div>`;
}

function planEdit(plan, ui) {
  const people = plan.people.map((p, i) => `
    <label class="lbl">Person ${i + 1} ${field(ui, `people.${i}.name`, p.name, 'text')}</label>`).join('');

  const accounts = plan.accounts.map((a, i) => `
    <div class="card edit-card">
      <div class="edit-line">
        <label class="lbl grow">Account ${field(ui, `accounts.${i}.name`, a.name, 'text')}</label>
        ${removeRowButton('accounts', i, 'Remove this account')}
      </div>
      <label class="lbl">What it is for ${field(ui, `accounts.${i}.job`, a.job, 'textOptional')}</label>
      <label class="lbl">Role ${choice(ui, `accounts.${i}.role`, a.role, ROLES)}</label>
    </div>`).join('');

  const sources = plan.incomeSources.map((s) => ({ id: s.id, name: s.name }));
  const accountOptions = plan.accounts.map((a) => ({ id: a.id, name: a.name }));
  const transfers = plan.transfers.map((t, i) => `
    <div class="card edit-card">
      <div class="edit-line">
        <label class="lbl grow">From which pay ${choice(ui, `transfers.${i}.incomeSourceId`, t.incomeSourceId, sources)}</label>
        ${removeRowButton('transfers', i, 'Remove this transfer')}
      </div>
      <div class="edit-line">
        <label class="lbl">From ${choice(ui, `transfers.${i}.fromAccountId`, t.fromAccountId, accountOptions)}</label>
        <label class="lbl">To ${choice(ui, `transfers.${i}.toAccountId`, t.toAccountId, accountOptions, { allowEmpty: true })}</label>
      </div>
      <div class="edit-line">
        <label class="lbl">Kind ${choice(ui, `transfers.${i}.rule`, t.rule, RULES)}</label>
        <label class="lbl narrow">Amount ${field(ui, `transfers.${i}.amount`, t.amount, 'money')}</label>
      </div>
    </div>`).join('');

  return `
  <h3 class="form-title">Budget period</h3>
  <div class="card edit-card">
    <label class="lbl">Name ${field(ui, 'period.label', plan.period.label, 'textOptional')}</label>
    <div class="edit-line">
      <label class="lbl">Starts ${field(ui, 'period.start', plan.period.start, 'dateOrNull')}</label>
      <label class="lbl">Ends ${field(ui, 'period.end', plan.period.end, 'dateOrNull')}</label>
    </div>
  </div>
  <h3 class="form-title">People</h3>
  <div class="card edit-card"><div class="edit-line">${people}</div></div>
  <h3 class="form-title">Accounts</h3>
  <p class="hint page-hint">Names only. Never put account numbers or BSBs here.</p>
  ${accounts}
  <div class="form-actions">${addRowButton('accounts', 'Add an account')}</div>
  <h3 class="form-title spaced">Payday transfers</h3>
  <p class="hint page-hint">The checklist is built from this list, in this order within each pay. For "the rest of this pay" the amount is worked out, so leave it at 0.</p>
  ${transfers}
  <div class="form-actions">${addRowButton('transfers', 'Add a transfer')}</div>`;
}

export function render(state, ui) {
  const importErrors = (ui.importErrors || []).map((e) => `<li>${esc(e)}</li>`).join('');
  const pending = ui.pendingImport;
  return `
  <h1>Settings</h1>

  ${state.plan ? `
  <div class="section">
    <h2>The plan</h2>
    ${editBar(ui, { label: 'Edit accounts and transfers' })}
    ${ui.editing ? planEdit(state.plan, ui) : planRead(state.plan)}
  </div>` : ''}

  ${ui.editing ? '' : `
  <div class="section">
    <h2>Backup</h2>
    <div class="card">
      <p class="hint">Export saves every figure, balance entry and past fortnight to a file on this device. Keep it somewhere private.</p>
      <div class="form-actions">
        <button class="small-btn" data-action="export"${ui.offline || !state.plan ? ' disabled' : ''}>Export to a file</button>
      </div>
    </div>
    <div class="card">
      <p class="hint">Import replaces <strong>everything</strong> with the contents of an export file: the plan, balance entries and history. Ticks are cleared.</p>
      ${importErrors ? `<div class="banner err" role="alert">This file can't be imported:<ul class="error-list">${importErrors}</ul></div>` : ''}
      ${pending ? `
        <div class="banner ok">Ready to import <strong>${esc(pending.name)}</strong>.</div>
        <div class="form-actions">
          ${confirmButton(ui, { action: 'import-confirm', label: 'Replace everything', confirmLabel: 'Yes, replace everything' })}
          <button class="small-btn" data-action="import-cancel">Cancel</button>
        </div>` : `
        <label class="file-label${ui.offline ? ' disabled' : ''}">
          <input type="file" accept="application/json,.json" data-input="import-file"${ui.offline ? ' disabled' : ''} />
          <span>Choose an export file</span>
        </label>`}
    </div>
  </div>

  <div class="section">
    <h2>Password</h2>
    <form class="card edit-card" data-form="password" novalidate>
      ${ui.passwordError ? `<div class="banner err" role="alert">${esc(ui.passwordError)}</div>` : ''}
      ${ui.passwordDone ? '<div class="banner ok" role="status">Password changed. Use the new one next time you sign in.</div>' : ''}
      <input type="text" name="username" autocomplete="username" value="${esc(ui.userEmail || '')}" hidden />
      <label class="lbl">New password <input class="form-input" type="password" name="password" autocomplete="new-password" /></label>
      <label class="lbl">New password again <input class="form-input" type="password" name="again" autocomplete="new-password" /></label>
      <p class="hint">At least 10 characters. This changes the password for this sign-in on every device.</p>
      <div class="form-actions"><button class="small-btn" type="submit"${ui.offline || ui.busy || ui.isDemo ? ' disabled' : ''}>Change password</button></div>
    </form>
  </div>

  <div class="section">
    <h2>This device</h2>
    <div class="card row-between">
      <span>Signed in as <strong>${esc(ui.userEmail || '')}</strong></span>
      <button class="small-btn" data-action="sign-out">Sign out</button>
    </div>
  </div>`}`;
}

export const actions = {
  'submit:password': async ({ form, ui, paint }) => {
    const problem = passwordProblem(form.elements.password.value, form.elements.again.value);
    Object.assign(ui, { passwordError: problem, passwordDone: false });
    if (problem) return paint();
    ui.busy = true;
    paint();
    try {
      await changePassword(form.elements.password.value);
      ui.passwordDone = true;
    } catch (error) {
      ui.passwordError = error.message;
    }
    ui.busy = false;
    return paint();
  },
};
