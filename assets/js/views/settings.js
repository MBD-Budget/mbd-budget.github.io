import { esc } from '../format.js';
import { confirmButton } from './shared.js';

export function render(state, ui) {
  const importErrors = (ui.importErrors || []).map((e) => `<li>${esc(e)}</li>`).join('');
  const pending = ui.pendingImport;
  return `
  <h1>Settings</h1>

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
    <h2>This device</h2>
    <div class="card row-between">
      <span>Signed in as <strong>${esc(ui.userEmail || '')}</strong></span>
      <button class="small-btn" data-action="sign-out">Sign out</button>
    </div>
  </div>`;
}
