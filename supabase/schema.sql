-- MBD Budget · database schema
-- Safe to run more than once. Contains no figures.
-- Access rule for everything: the signed-in user must be listed in `members`.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name    text not null
);

create table if not exists public.plan (
  id         integer primary key default 1 check (id = 1),
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.ticks (
  transfer_id text primary key,
  ticked_by   uuid default auth.uid(),
  ticked_at   timestamptz not null default now()
);

create table if not exists public.fortnight (
  id            integer primary key default 1 check (id = 1),
  landed_amount numeric(12,2) check (landed_amount is null or landed_amount >= 0),
  started_on    date not null default current_date
);
insert into public.fortnight (id) values (1) on conflict (id) do nothing;

create table if not exists public.history (
  id                  bigint generated always as identity primary key,
  closed_on           date not null default current_date,
  transfers_done      integer not null check (transfers_done >= 0),
  transfers_total     integer not null check (transfers_total >= 0),
  deposit_transferred numeric(12,2) not null check (deposit_transferred >= 0),
  closed_by           uuid default auth.uid()
);

create table if not exists public.balances (
  id         bigint generated always as identity primary key,
  account_id text not null,
  on_date    date not null,
  balance    numeric(12,2) not null check (balance >= 0),
  unique (account_id, on_date)
);

-- ---------------------------------------------------------------------------
-- Who is allowed
-- ---------------------------------------------------------------------------
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.members where user_id = (select auth.uid()));
$$;

revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

alter table public.members   enable row level security;
alter table public.plan      enable row level security;
alter table public.ticks     enable row level security;
alter table public.fortnight enable row level security;
alter table public.history   enable row level security;
alter table public.balances  enable row level security;

-- Nobody who is not signed in gets anything at all.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;

-- Members can see the member list but nobody can change it from the app.
revoke insert, update, delete on public.members from authenticated;

drop policy if exists members_read on public.members;
create policy members_read on public.members
  for select to authenticated using ((select public.is_member()));

do $$
declare t text;
begin
  foreach t in array array['plan', 'ticks', 'fortnight', 'history', 'balances'] loop
    execute format('drop policy if exists %I on public.%I', t || '_members', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.is_member())) with check ((select public.is_member()))',
      t || '_members', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Reset for next fortnight
-- Writes one history row, clears the ticks and the landed amount, all or nothing.
-- Works the totals out itself from the plan and the ticks.
-- ---------------------------------------------------------------------------
-- The caller passes its own calendar date, because the database's clock is UTC and would
-- record a morning reset in Australia as the day before. A date more than a day away from
-- the database's is ignored.
drop function if exists public.close_fortnight();

create or replace function public.close_fortnight(p_today date default null)
returns public.history
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan    jsonb;
  v_landed  numeric;
  v_done    integer;
  v_total   integer;
  v_deposit numeric;
  v_row     public.history;
  v_today   date := case when p_today is not null and abs(p_today - current_date) <= 1 then p_today else current_date end;
begin
  if not public.is_member() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- One reset at a time: a second caller waits here, then finds no ticks.
  select landed_amount into v_landed from public.fortnight where id = 1 for update;
  select data into v_plan from public.plan where id = 1;
  if v_plan is null then
    raise exception 'nothing to close';
  end if;

  with transfers as (
    select t ->> 'id'              as id,
           t ->> 'rule'            as rule,
           t ->> 'incomeSourceId'  as source_id,
           t ->> 'fromAccountId'   as from_id,
           t ->> 'toAccountId'     as to_id,
           coalesce((t ->> 'amount')::numeric, 0) as amount
    from jsonb_array_elements(v_plan -> 'transfers') as t
  ),
  deposit_accounts as (
    select a ->> 'id' as id
    from jsonb_array_elements(v_plan -> 'accounts') as a
    where a ->> 'role' = 'deposit'
  ),
  worth as (
    select tr.id, tr.to_id,
           case when tr.rule = 'remainder' then
             greatest(
               coalesce(v_landed, 0) - coalesce((
                 select sum(o.amount) from transfers o
                 where o.source_id = tr.source_id and o.from_id = tr.from_id
                   and o.id <> tr.id and o.rule <> 'remainder'), 0),
               0)
           else tr.amount end as amount
    from transfers tr
    where tr.rule <> 'stays'
  )
  select count(*) filter (where k.transfer_id is not null),
         count(*),
         coalesce(sum(w.amount) filter (where k.transfer_id is not null and w.to_id in (select id from deposit_accounts)), 0)
    into v_done, v_total, v_deposit
  from worth w
  left join public.ticks k on k.transfer_id = w.id;

  if v_done = 0 then
    raise exception 'nothing to close';
  end if;

  insert into public.history (closed_on, transfers_done, transfers_total, deposit_transferred)
  values (v_today, v_done, v_total, round(v_deposit, 2))
  returning * into v_row;

  delete from public.ticks where true;
  update public.fortnight set landed_amount = null, started_on = v_today where id = 1;

  return v_row;
end;
$$;

revoke all on function public.close_fortnight(date) from public, anon;
grant execute on function public.close_fortnight(date) to authenticated;

-- ---------------------------------------------------------------------------
-- Live updates between the two phones
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['plan', 'ticks', 'fortnight', 'history', 'balances'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
