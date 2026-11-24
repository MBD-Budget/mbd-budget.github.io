# MBD Budget

A small private web app for one household: a payday transfer checklist, income, cost of living and a savings goal. It is a static site (plain HTML, CSS and JavaScript, no build step) that signs in to a Supabase database. The code holds no figures; every number lives in the database behind a login.

## Run it locally

```
python3 -m http.server 8791 --bind 127.0.0.1
```

Then open http://127.0.0.1:8791/.

## Tests

```
npm test
```

Uses Node's built-in test runner. There are no dependencies to install.

## Layout

| Path | What it is |
|---|---|
| `assets/js/plan.js` | The plan document: validation, parsing typed amounts, blank rows |
| `assets/js/compute.js` | Every calculation, as pure functions |
| `assets/js/store.js` | All reads and writes; keeps the last state on the device |
| `assets/js/views/` | One module per page |
| `supabase/schema.sql` | Tables, access rules and the fortnight reset |
| `supabase/checks.sh` | Checks that only members can read or write |
| `seed/plan.example.json` | A made-up plan in the export format |

## Try it without signing in

Add `?demo` to the address. The app runs on the made-up figures in `seed/plan.example.json`, held in memory. Nothing is saved and no database is touched.

## How to

**Put it on a phone's home screen.** Open the site in Safari, tap Share, then "Add to Home Screen". Sign in once; it stays signed in.

**Change a figure.** Each page has an Edit button at the top. Change what you need and press Save. Accounts, the transfer list and the budget period are under Settings.

**Run a fortnight.** Tick each transfer as you make it. For the casual pay, type the amount that actually landed first; the "rest of this pay" transfer is worked out from it. When the fortnight is finished, press "Reset for next fortnight" on the Checklist. That saves the fortnight to the history and clears the ticks on every device.

**Keep a backup.** Settings → Export to a file. It contains every figure, so keep it somewhere private. Settings → Import puts a backup back, replacing everything.

**Wake a paused database.** Supabase pauses free projects after about a week without use. The app then shows "Can't reach the database" with the last figures this device saw. Open the Supabase dashboard, open the project and press Restore; it takes a few minutes.

**Change your password.** Settings → Password.

**Publish a change.** Edit the files, run `npm test`, bump the `?v=` number in `index.html` (three places), commit and `git push origin main`. GitHub Pages publishes within a minute or two.

## Privacy rules for this repo

This repo is public. Never commit real figures, names or anything personal: not in code, tests, commit messages or docs. `seed/plan.json` and `docs/superpowers/` are ignored by git for that reason. Never put bank account numbers or BSBs anywhere, including the database.

## Checking the access rules

`supabase/checks.sh` proves that only members can read or write. It needs test data loaded and two test sign-ins; see the notes at the top of the file. Do not run it against real figures: it ticks rows and resets a fortnight.
