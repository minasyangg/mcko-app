-- Модуль уведомлений: telegram-привязка профиля, настройки событий (admin),
-- журнал отправок. Каналы расширяемы (telegram сейчас, email потом).

-- 1. Привязка Telegram к профилю
alter table profiles add column if not exists telegram_username text;
alter table profiles add column if not exists telegram_chat_id bigint;

-- 2. Настройки: какие события каким каналом слать (управляет админ).
--    Отсутствие строки = включено по умолчанию; выключение создаёт строку.
create table if not exists notification_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  event_type text not null,
  channel text not null default 'telegram',
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (organization_id, event_type, channel)
);
alter table notification_settings enable row level security;

create policy "notif_settings: admin manage org" on notification_settings
  for all
  using (auth_role() = 'admin' and organization_id = auth_org())
  with check (auth_role() = 'admin' and organization_id = auth_org());

-- 3. Журнал отправленных уведомлений (пишет только сервер service-role)
create table if not exists notification_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id),
  user_id uuid references profiles(id) on delete set null,
  channel text not null,
  event_type text not null,
  message text,
  status text not null default 'sent', -- sent | failed | skipped
  error text,
  created_at timestamptz not null default now()
);
alter table notification_log enable row level security;

create policy "notif_log: admin read org" on notification_log
  for select
  using (auth_role() = 'admin' and organization_id = auth_org());
-- запись — только service role (политика на insert отсутствует намеренно)

create index if not exists idx_notification_log_created on notification_log (created_at desc);
create index if not exists idx_profiles_telegram_username on profiles (lower(telegram_username)) where telegram_username is not null;
