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
