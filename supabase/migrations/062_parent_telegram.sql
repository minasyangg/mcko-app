-- Telegram-уведомления родителю ученика. Родитель не отдельный пользователь
-- платформы (нет входа, нет profiles-строки) — просто второй Telegram-
-- получатель, привязанный к профилю ученика той же механикой, что и сам
-- ученик: ник указывает админ в карточке ученика → родитель жмёт /start у
-- бота → chat_id привязывается. Общий с учеником notifications_enabled
-- (миграция 027) — отдельного переключателя для родителя нет: если ученик
-- выключил уведомления себе, платформа не пишет и его родителю.
alter table profiles add column if not exists parent_telegram_username text;
alter table profiles add column if not exists parent_telegram_chat_id bigint;

create index if not exists idx_profiles_parent_telegram_username
  on profiles (lower(parent_telegram_username)) where parent_telegram_username is not null;
