// Pieces every page uses: the Edit/Save bar, inputs bound to a place in the plan,
// and the two-step confirm button (no browser dialogs).
import { esc } from '../format.js';

export function editBar(ui, { label = 'Edit figures' } = {}) {
  if (ui.offline) return '';
  if (!ui.editing) {
    return `<div class="edit-bar"><button class="small-btn" data-action="edit-start">${esc(label)}</button></div>`;
  }
  return `
  <div class="edit-bar editing">
    <span class="edit-bar-note">Editing. Changes are shared with both phones when you save.</span>
    <button class="small-btn" data-action="edit-cancel">Cancel</button>
    <button class="small-btn primary" data-action="edit-save"${ui.busy ? ' disabled' : ''}>Save</button>
  </div>`;
}

function fieldError(ui, path) {
  const error = (ui.errors || []).find((e) => e.path === path);
  return error ? `<span class="field-error">${esc(error.message)}</span>` : '';
}

// An input whose value is written back to `path` in the plan on Save.
export function field(ui, path, value, type = 'money', { label = '', width = '', placeholder = '' } = {}) {
  const shown = value === null || value === undefined ? '' : value;
  const numeric = type === 'money' || type === 'moneyOrNull' || type === 'number';
  const inputType = type === 'date' || type === 'dateOrNull' ? 'date' : 'text';
  const bad = (ui.errors || []).some((e) => e.path === path);
  return `<span class="field${width ? ` field-${width}` : ''}">
    <input class="form-input${bad ? ' invalid' : ''}" type="${inputType}" ${numeric ? 'inputmode="decimal"' : ''}
      data-path="${esc(path)}" data-type="${esc(type)}" value="${esc(shown)}"
      ${label ? `aria-label="${esc(label)}"` : ''} ${placeholder ? `placeholder="${esc(placeholder)}"` : ''} autocomplete="off" />
    ${fieldError(ui, path)}
  </span>`;
}

export function choice(ui, path, value, options, { label = '', allowEmpty = false, type = 'choice' } = {}) {
  const opts = (allowEmpty ? [{ id: '', name: '–' }] : []).concat(options)
    .map((o) => `<option value="${esc(o.id)}"${String(o.id) === String(value ?? '') ? ' selected' : ''}>${esc(o.name)}</option>`).join('');
  return `<span class="field"><select class="form-input" data-path="${esc(path)}" data-type="${esc(type)}" ${label ? `aria-label="${esc(label)}"` : ''}>${opts}</select></span>`;
}

export function tickbox(ui, path, value, label) {
  return `<label class="check-label"><input type="checkbox" data-path="${esc(path)}" data-type="bool"${value ? ' checked' : ''} /> ${esc(label)}</label>`;
}

// First tap arms it, second tap does it. `ui.armed` holds the armed action's key.
export function confirmButton(ui, { action, key = action, label, confirmLabel, cls = 'danger', disabled = false, attrs = '' }) {
  if (ui.armed === key) {
    return `<span class="confirm-pair">
      <button class="${cls} small-btn" data-action="${esc(action)}" ${attrs}${ui.busy ? ' disabled' : ''}>${esc(confirmLabel)}</button>
      <button class="small-btn" data-action="disarm">Cancel</button>
    </span>`;
  }
  return `<button class="${cls} small-btn" data-action="arm" data-key="${esc(key)}"${disabled ? ' disabled' : ''}>${esc(label)}</button>`;
}

export function addRowButton(list, label) {
  return `<button class="small-btn" data-action="row-add" data-list="${esc(list)}">+ ${esc(label)}</button>`;
}

export function removeRowButton(list, index, label = 'Remove') {
  return `<button class="icon-btn danger" data-action="row-remove" data-list="${esc(list)}" data-index="${index}" aria-label="${esc(label)}" title="${esc(label)}">×</button>`;
}

export function comingSoon(title) {
  return `<h1>${esc(title)}</h1><div class="card"><p class="hint">Coming in the next step.</p></div>`;
}
