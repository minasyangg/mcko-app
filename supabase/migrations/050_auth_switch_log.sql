-- Журнал быстрого переключения между аккаунтами (админ ↔ учитель одного
-- человека, см. lib/auth/switch-accounts.ts).
--
-- Механизм пускает в чужой аккаунт, поэтому каждый переход должен оставлять
-- след: иначе действия, сделанные после переключения, невозможно связать с тем,
-- кто их на самом деле совершил.
create table if not exists auth_switch_log (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid references profiles(id) on delete set null,
  to_user_id uuid references profiles(id) on delete set null,
  -- Требовался ли пароль: переход в админа всегда с паролем, обратно — без.
  -- Хранится, чтобы по журналу было видно, какой именно барьер сработал.
  with_password boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists auth_switch_log_from_idx on auth_switch_log(from_user_id, created_at desc);

alter table auth_switch_log enable row level security;

-- Пишет только сервер (service role, RLS не касается). Читать может админ
-- своей организации — журнал безопасности не должен быть виден учителю,
-- который в этот аккаунт переключается.
drop policy if exists "auth_switch_log: admin read" on auth_switch_log;
create policy "auth_switch_log: admin read" on auth_switch_log
  for select using (auth_role() = 'admin');
