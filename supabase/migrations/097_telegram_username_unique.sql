-- 097: ник Telegram уникален среди живых профилей — сразу по обоим полям.
--
-- Ник — единственный ключ, по которому webhook /start находит профиль и
-- пишет ему chat_id, но уникальным он не был. Живой случай 2026-10-10:
-- ученица завела второй аккаунт саморегистрацией с тем же ником, бот
-- привязался к пустому дублю (без групп и назначений), а с основного
-- аккаунта /start стал невозможен — webhook отказывает при неоднозначном
-- совпадении (см. app/api/telegram/webhook). Уведомления о 16 назначениях
-- молча не дошли.
--
-- Занятость считается по ОБОИМ полям: telegram_username (свой ник) и
-- parent_telegram_username (ник родителя ученика) — webhook ищет по обоим,
-- и совпадение «свой у одного — родительский у другого» (или оба на одном
-- профиле) для него так же неоднозначно. Обычный unique index такое не
-- выражает (два поля + исключение удалённых профилей), поэтому — триггер.
-- Удалённые (deleted_at) не в счёт: webhook их тоже не ищет.

-- Кто уже занял ник, не считая профиля p_exclude_id. API-роуты проверяют то
-- же правило до записи, чтобы показать понятный текст
-- (lib/notifications/telegram-username.ts), а триггер — гарантия при гонках
-- и при правке профиля в обход API через политику «update own».
create or replace function public.telegram_username_holder(p_username text, p_exclude_id uuid default null)
returns table (id uuid, full_name text, organization_id uuid, as_parent boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.organization_id,
         coalesce(lower(p.parent_telegram_username) = lower(p_username), false)
  from profiles p
  where p.deleted_at is null
    and p.id is distinct from p_exclude_id
    and (lower(p.telegram_username) = lower(p_username)
         or lower(p.parent_telegram_username) = lower(p_username))
  limit 1
$$;

revoke all on function public.telegram_username_holder(text, uuid) from public, anon, authenticated;

-- security definer: проверка обязана видеть ВСЕ профили, а не только
-- доступные по RLS тому, кто пишет (ученик через «update own» видит лишь себя).
create or replace function public.profiles_telegram_username_unique()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nick text;
begin
  if new.deleted_at is not null then
    return new;
  end if;

  if lower(new.telegram_username) = lower(new.parent_telegram_username) then
    raise exception using
      errcode = '23505',
      message = format('Ник Telegram @%s указан и как свой, и как ник родителя', new.telegram_username),
      hint = 'telegram_username_taken';
  end if;

  foreach v_nick in array array[new.telegram_username, new.parent_telegram_username] loop
    continue when v_nick is null;
    -- сериализует одновременные записи одного ника, иначе обе транзакции
    -- прошли бы проверку до коммита друг друга
    perform pg_advisory_xact_lock(hashtext('telegram_username:' || lower(v_nick)));
    if exists (select 1 from telegram_username_holder(v_nick, new.id)) then
      raise exception using
        errcode = '23505',
        message = format('Ник Telegram @%s уже указан в другом профиле платформы', v_nick),
        hint = 'telegram_username_taken';
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.profiles_telegram_username_unique() from public, anon, authenticated;

drop trigger if exists trg_profiles_telegram_username_unique on public.profiles;
create trigger trg_profiles_telegram_username_unique
  before insert or update of telegram_username, parent_telegram_username on public.profiles
  for each row execute function public.profiles_telegram_username_unique();
