import { esc } from '../format.js';

export function render(ui) {
  return `
  <h1>Sign in</h1>
  <form class="card signin-card" data-form="signin" novalidate>
    ${ui.signinError ? `<div class="banner err" role="alert">${esc(ui.signinError)}</div>` : ''}
    <label class="form-label">Email
      <input class="form-input" type="email" name="email" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${esc(ui.signinEmail || '')}" />
    </label>
    <label class="form-label">Password
      <input class="form-input" type="password" name="password" autocomplete="current-password" required />
    </label>
    <div class="form-actions">
      <button class="primary" type="submit"${ui.busy ? ' disabled' : ''}>${ui.busy ? 'Signing in…' : 'Sign in'}</button>
    </div>
  </form>
  <p class="hint">This app is private to our household. There is no sign-up.</p>`;
}
