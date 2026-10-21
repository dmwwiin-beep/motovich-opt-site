-- MOTOVICH cloud state and server-side AI quota.
-- Apply this migration in Supabase SQL Editor or with the Supabase CLI.
begin;

create table if not exists public.motovich_user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  schema_version integer not null default 2 check (schema_version between 1 and 100),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

alter table public.motovich_user_state enable row level security;
revoke all on table public.motovich_user_state from anon, authenticated;
grant select, insert, update, delete on table public.motovich_user_state to authenticated;

drop policy if exists "motovich state select own" on public.motovich_user_state;
drop policy if exists "motovich state insert own" on public.motovich_user_state;
drop policy if exists "motovich state update own" on public.motovich_user_state;
drop policy if exists "motovich state delete own" on public.motovich_user_state;

create policy "motovich state select own"
  on public.motovich_user_state for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "motovich state insert own"
  on public.motovich_user_state for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "motovich state update own"
  on public.motovich_user_state for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "motovich state delete own"
  on public.motovich_user_state for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.motovich_touch_state_revision()
returns trigger
language plpgsql
set search_path = ''
as $
begin
  new.updated_at := now();
  new.revision := old.revision + 1;
  return new;
end;
$;

drop trigger if exists motovich_user_state_touch on public.motovich_user_state;
create trigger motovich_user_state_touch
  before update on public.motovich_user_state
  for each row execute function public.motovich_touch_state_revision();

create table if not exists public.motovich_ai_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default ((now() at time zone 'utc')::date),
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, usage_date)
);

alter table public.motovich_ai_daily_usage enable row level security;
revoke all on table public.motovich_ai_daily_usage from anon, authenticated;

-- A user can consume at most 30 AI-coach requests per UTC day.
-- The caller cannot choose the limit; the table is not directly accessible to browser roles.
create or replace function public.motovich_consume_ai_coach_request()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  consumed boolean;
  caller_id uuid;
begin
  caller_id := (select auth.uid());
  if caller_id is null then
    return false;
  end if;

  insert into public.motovich_ai_daily_usage (user_id, usage_date, request_count)
  values (caller_id, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, usage_date)
  do update
    set request_count = public.motovich_ai_daily_usage.request_count + 1
    where public.motovich_ai_daily_usage.request_count < 30
  returning true into consumed;

  return coalesce(consumed, false);
end;
$$;

revoke all on function public.motovich_consume_ai_coach_request() from public, anon, authenticated;
grant execute on function public.motovich_consume_ai_coach_request() to authenticated;

commit;
