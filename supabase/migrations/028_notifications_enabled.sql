-- Персональный выключатель уведомлений: по умолчанию включён, пользователь
-- может отключить в настройках профиля и включить снова. Проверяется в
-- notifyUsers перед отправкой (в дополнение к организационным настройкам события).
alter table profiles add column if not exists notifications_enabled boolean not null default true;
