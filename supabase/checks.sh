#!/usr/bin/env bash
# Security checks for the MBD Budget database. Contains no secrets and no figures.
#
# Needs the made-up example plan (seed/plan.example.json) loaded, and these in the environment:
#   SUPABASE_URL, SUPABASE_KEY (the publishable key)
#   MEMBER_EMAIL, MEMBER_PASSWORD       a signed-in account that IS in `members`
#   OUTSIDER_EMAIL, OUTSIDER_PASSWORD   a signed-in account that is NOT in `members`
#   EXPECT_SIGNUP_OFF=1                 once sign-ups have been switched off in the dashboard
#
# The full run ticks rows, clears ticks and closes a fortnight, so use it only against test data.
# With READ_ONLY=1 it runs only the lock-out checks (parts 1, 2 and 4), which change nothing
# and are safe against real figures; the member sign-in is then not needed.
set -u
: "${SUPABASE_URL:?}" "${SUPABASE_KEY:?}" "${OUTSIDER_EMAIL:?}" "${OUTSIDER_PASSWORD:?}"
READ_ONLY=${READ_ONLY:-0}
if [ "$READ_ONLY" != 1 ]; then : "${MEMBER_EMAIL:?}" "${MEMBER_PASSWORD:?}"; fi

TABLES="members plan ticks fortnight history balances"
pass=0; fail=0
ok()  { pass=$((pass + 1)); printf '  PASS  %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf '  FAIL  %s\n' "$1"; }

# call METHOD PATH TOKEN [BODY] -> prints "STATUS<TAB>BODY"
call() {
  local method=$1 path=$2 token=$3 body=${4:-} extra=${5:-}
  local args=(-s -m 30 -X "$method" "$SUPABASE_URL$path" -H "apikey: $SUPABASE_KEY" -H "Content-Type: application/json" -w $'\n%{http_code}')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$body" ] && args+=(-d "$body")
  [ -n "$extra" ] && args+=(-H "$extra")
  local out; out=$(curl "${args[@]}")
  printf '%s\t%s' "${out##*$'\n'}" "${out%$'\n'*}"
}
status() { printf '%s' "${1%%$'\t'*}"; }
body()   { printf '%s' "${1#*$'\t'}"; }
token_for() {
  call POST "/auth/v1/token?grant_type=password" "" "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | cut -f2- | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"
}
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null; }

# No rows may come back, and nothing may be written.
locked_out() {
  local who=$1 token=$2 r
  for t in $TABLES; do
    r=$(call GET "/rest/v1/$t?select=*" "$token")
    case "$(status "$r")" in
      401|403) ok "$who cannot read $t (refused)";;
      200) if [ "$(body "$r")" = "[]" ]; then ok "$who reads no rows from $t"; else bad "$who can read $t"; fi;;
      *) bad "$who reading $t gave $(status "$r")";;
    esac
  done
  r=$(call POST "/rest/v1/ticks" "$token" '{"transfer_id":"check-intruder"}')
  case "$(status "$r")" in 401|403) ok "$who cannot add a tick";; *) bad "$who adding a tick gave $(status "$r")";; esac
  r=$(call POST "/rest/v1/plan?on_conflict=id" "$token" '{"id":1,"data":{}}')
  case "$(status "$r")" in 401|403) ok "$who cannot change the plan";; *) bad "$who changing the plan gave $(status "$r")";; esac
  # An update the rules hide from you answers "done" but touches no rows, so ask for the rows back.
  r=$(call PATCH "/rest/v1/fortnight?id=eq.1&select=id" "$token" '{"landed_amount":1}' "Prefer: return=representation")
  case "$(status "$r")" in
    401|403) ok "$who cannot change the landed amount";;
    200) if [ "$(body "$r")" = "[]" ]; then ok "$who cannot change the landed amount (no rows touched)"; else bad "$who changed the landed amount"; fi;;
    *) bad "$who changing the landed amount gave $(status "$r")";;
  esac
  r=$(call DELETE "/rest/v1/balances?id=gte.0&select=id" "$token" "" "Prefer: return=representation")
  case "$(status "$r")" in
    401|403) ok "$who cannot delete balances";;
    200) if [ "$(body "$r")" = "[]" ]; then ok "$who cannot delete balances (no rows touched)"; else bad "$who deleted balances"; fi;;
    *) bad "$who deleting balances gave $(status "$r")";;
  esac
  r=$(call POST "/rest/v1/rpc/close_fortnight" "$token" '{}')
  case "$(status "$r")" in 401|403|404) ok "$who cannot reset the fortnight";; *) bad "$who resetting the fortnight gave $(status "$r"): $(body "$r")";; esac
  r=$(call POST "/rest/v1/members" "$token" '{"user_id":"00000000-0000-0000-0000-000000000000","name":"x"}')
  case "$(status "$r")" in 401|403) ok "$who cannot add a member";; *) bad "$who adding a member gave $(status "$r")";; esac
}

echo "1. Publishable key only (not signed in)"
locked_out "A visitor" ""

echo "2. Signed in, but not a member"
OUT=$(token_for "$OUTSIDER_EMAIL" "$OUTSIDER_PASSWORD")
if [ -z "$OUT" ]; then bad "could not sign the outsider in"; else locked_out "A non-member" "$OUT"; fi

echo "3. Signed in as a member"
MEM=""
if [ "$READ_ONLY" = 1 ]; then echo "  SKIP  read-only run"
elif MEM=$(token_for "$MEMBER_EMAIL" "$MEMBER_PASSWORD"); [ -z "$MEM" ]; then bad "could not sign the member in"; else
  r=$(call GET "/rest/v1/plan?select=id" "$MEM")
  [ "$(body "$r" | json 'len(d)')" = 1 ] && ok "A member can read the plan" || bad "A member cannot read the plan"
  call DELETE "/rest/v1/ticks?transfer_id=neq." "$MEM" >/dev/null
  r=$(call POST "/rest/v1/ticks" "$MEM" '{"transfer_id":"check-tick"}')
  [ "$(status "$r")" = 201 ] && ok "A member can add a tick" || bad "A member adding a tick gave $(status "$r")"
  s=$(status "$(call POST "/rest/v1/ticks?on_conflict=transfer_id" "$MEM" '{"transfer_id":"check-tick"}' "Prefer: resolution=ignore-duplicates")")
  { [ "$s" = 201 ] || [ "$s" = 200 ]; } && ok "Ticking the same row twice is harmless" || bad "Ticking twice gave $s"
  r=$(call DELETE "/rest/v1/ticks?transfer_id=eq.check-tick" "$MEM")
  [ "$(status "$r")" = 204 ] && ok "A member can remove a tick" || bad "A member removing a tick gave $(status "$r")"
  r=$(call POST "/rest/v1/members" "$MEM" '{"user_id":"00000000-0000-0000-0000-000000000000","name":"x"}')
  case "$(status "$r")" in 401|403) ok "A member cannot add another member";; *) bad "A member adding a member gave $(status "$r")";; esac
fi

echo "4. Sign-up"
if [ "${EXPECT_SIGNUP_OFF:-0}" = 1 ]; then
  r=$(call POST "/auth/v1/signup" "" "{\"email\":\"check-signup-$RANDOM@example.com\",\"password\":\"$(openssl rand -hex 12)\"}")
  case "$(status "$r")" in 4*) ok "New sign-ups are refused";; *) bad "A new account could be created ($(status "$r"))";; esac
else
  echo "  SKIP  sign-ups not checked; set EXPECT_SIGNUP_OFF=1 once they are switched off in the dashboard"
fi

echo "5. Reset for next fortnight (example plan)"
if [ -n "$MEM" ]; then
  before=$(call GET "/rest/v1/history?select=id" "$MEM" | cut -f2- | json 'len(d)')
  call POST "/rest/v1/ticks" "$MEM" '[{"transfer_id":"t1"},{"transfer_id":"t8"},{"transfer_id":"stale-id"}]' >/dev/null
  call PATCH "/rest/v1/fortnight?id=eq.1" "$MEM" '{"landed_amount":1100}' >/dev/null
  r=$(call POST "/rest/v1/rpc/close_fortnight" "$MEM" '{}')
  got=$(body "$r" | json '"%s %s %s" % (d["transfers_done"], d["transfers_total"], float(d["deposit_transferred"]))')
  [ "$got" = "2 11 1600.0" ] && ok "First reset records 2 of 11 and 1600 to the deposit" || bad "First reset recorded '$got' ($(status "$r") $(body "$r"))"
  new_id=$(body "$r" | json 'd["id"]')
  r=$(call POST "/rest/v1/rpc/close_fortnight" "$MEM" '{}')
  body "$r" | grep -q "nothing to close" && ok "Second reset is refused: nothing to close" || bad "Second reset gave $(status "$r") $(body "$r")"
  after=$(call GET "/rest/v1/history?select=id" "$MEM" | cut -f2- | json 'len(d)')
  [ "$after" = "$((before + 1))" ] && ok "Exactly one history entry was added" || bad "History went from $before to $after"
  left=$(call GET "/rest/v1/ticks?select=transfer_id" "$MEM" | cut -f2- | json 'len(d)')
  landed=$(call GET "/rest/v1/fortnight?select=landed_amount" "$MEM" | cut -f2- | json 'd[0]["landed_amount"]')
  [ "$left" = 0 ] && [ "$landed" = None ] && ok "Ticks and the landed amount were cleared" || bad "After reset: $left ticks, landed $landed"
  [ -n "$new_id" ] && call DELETE "/rest/v1/history?id=eq.$new_id" "$MEM" >/dev/null
fi

echo
echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
