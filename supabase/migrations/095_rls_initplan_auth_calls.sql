-- 095: RLS — auth_role()/auth_org()/auth.uid()/auth.role() вычисляются один раз
-- на запрос, а не на каждую строку.
--
-- auth_role() и auth_org() — SECURITY DEFINER-функции, Postgres не может их
-- встроить и вызывал на КАЖДОЙ проверяемой строке (каждый вызов — поиск в
-- profiles). Пример: count(*) по library_problems (21k строк) под учителем —
-- 313 мс только на RLS. Обёртка в (SELECT ...) превращает вызов в InitPlan:
-- значение считается один раз на запрос. Результат тот же — функции не
-- зависят от строки. Это рекомендация Supabase (advisor auth_rls_initplan).
--
-- Меняем только выражения USING / WITH CHECK через ALTER POLICY — имя,
-- команда, роли и permissive/restrictive у политик остаются прежними.
-- check_*_by_auth(col) не трогаем: они зависят от строки.
--
-- Откат: оригинальные выражения сохранены в public._rls_policy_backup_095,
-- см. блок «ОТКАТ» в конце файла.

create table if not exists public._rls_policy_backup_095 as
  select schemaname, tablename, policyname, qual, with_check
  from pg_policies where schemaname = 'public';
alter table public._rls_policy_backup_095 enable row level security;
revoke all on public._rls_policy_backup_095 from anon, authenticated;

create or replace function pg_temp.wrap_auth_calls(t text) returns text
language sql immutable as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(t,
    '(?<!SELECT )\mauth_role\(\)', '(SELECT auth_role())', 'g'),
    '(?<!SELECT )\mauth_org\(\)',  '(SELECT auth_org())',  'g'),
    '(?<!SELECT )\mauth\.uid\(\)', '(SELECT auth.uid())',  'g'),
    '(?<!SELECT )\mauth\.role\(\)', '(SELECT auth.role())', 'g')
$$;

do $$
declare
  r record;
  q text;
  w text;
  n int := 0;
begin
  for r in select * from pg_policies where schemaname = 'public' loop
    q := pg_temp.wrap_auth_calls(r.qual);
    w := pg_temp.wrap_auth_calls(r.with_check);
    if q is distinct from r.qual or w is distinct from r.with_check then
      execute format('ALTER POLICY %I ON %I.%I%s%s',
        r.policyname, r.schemaname, r.tablename,
        case when q is not null then ' USING (' || q || ')' else '' end,
        case when w is not null then ' WITH CHECK (' || w || ')' else '' end);
      n := n + 1;
    end if;
  end loop;
  raise notice '095: переписано политик: %', n;

  if exists (
    select 1 from pg_policies where schemaname = 'public'
      and (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
          ~ '(?<!SELECT )\m(auth_role|auth_org|auth\.uid|auth\.role)\(\)'
  ) then
    raise exception '095: остались необёрнутые вызовы auth-функций';
  end if;
end $$;

-- ОТКАТ (выполнить вручную при необходимости):
-- do $$
-- declare r record;
-- begin
--   for r in select * from public._rls_policy_backup_095 loop
--     if exists (select 1 from pg_policies p where p.schemaname = r.schemaname
--                and p.tablename = r.tablename and p.policyname = r.policyname) then
--       execute format('ALTER POLICY %I ON %I.%I%s%s', r.policyname, r.schemaname, r.tablename,
--         case when r.qual is not null then ' USING (' || r.qual || ')' else '' end,
--         case when r.with_check is not null then ' WITH CHECK (' || r.with_check || ')' else '' end);
--     end if;
--   end loop;
-- end $$;
