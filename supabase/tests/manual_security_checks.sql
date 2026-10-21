-- Run in Supabase SQL Editor after applying the migration.
-- Read-only structural checks; raises an error if the security setup is incomplete.
do $$
declare
  state_rls boolean;
  usage_rls boolean;
  push_rls boolean;
  policy_count integer;
begin
  select c.relrowsecurity into state_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'motovich_user_state';
  if coalesce(state_rls, false) is not true then
    raise exception 'RLS must be enabled on public.motovich_user_state';
  end if;

  select c.relrowsecurity into usage_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'motovich_ai_daily_usage';
  if coalesce(usage_rls, false) is not true then
    raise exception 'RLS must be enabled on public.motovich_ai_daily_usage';
  end if;

  select c.relrowsecurity into push_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'motovich_push_subscriptions';
  if coalesce(push_rls, false) is not true then
    raise exception 'RLS must be enabled on public.motovich_push_subscriptions';
  end if;
  if has_table_privilege('anon', 'public.motovich_push_subscriptions', 'select') then
    raise exception 'anon must not read push subscription records';
  end if;
  if not has_table_privilege('authenticated', 'public.motovich_push_subscriptions', 'select') then
    raise exception 'authenticated users need SELECT privilege on their own push subscription rows';
  end if;

  if has_table_privilege('anon', 'public.motovich_user_state', 'select') then
    raise exception 'anon must not read user state';
  end if;
  if not has_table_privilege('authenticated', 'public.motovich_user_state', 'select') then
    raise exception 'authenticated users need SELECT privilege on their RLS-protected state';
  end if;
  if has_table_privilege('authenticated', 'public.motovich_ai_daily_usage', 'select') then
    raise exception 'browser users must not read the AI quota table directly';
  end if;

  select count(*) into policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'motovich_user_state'
    and policyname in (
      'motovich state select own',
      'motovich state insert own',
      'motovich state update own',
      'motovich state delete own'
    );
  if policy_count <> 4 then
    raise exception 'Expected all four per-user state RLS policies, found %', policy_count;
  end if;

  select count(*) into policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'motovich_push_subscriptions'
    and policyname in (
      'motovich push select own',
      'motovich push insert own',
      'motovich push update own',
      'motovich push delete own'
    );
  if policy_count <> 4 then
    raise exception 'Expected all four per-user push RLS policies, found %', policy_count;
  end if;

  if not has_function_privilege('authenticated', 'public.motovich_consume_ai_coach_request()', 'execute') then
    raise exception 'authenticated users must call the quota RPC';
  end if;
  if has_function_privilege('anon', 'public.motovich_consume_ai_coach_request()', 'execute') then
    raise exception 'anon must not call the quota RPC';
  end if;

  raise notice 'MOTOVICH cloud and Web Push schema security checks passed.';
end $$;
