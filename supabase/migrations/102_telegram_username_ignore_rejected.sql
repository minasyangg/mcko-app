-- 102: отклонённая заявка на регистрацию не занимает ник Telegram.
--
-- Живой случай 2026-10-13: пришла заявка от ученика, у которого уже есть
-- аккаунт. Админ отклонил заявку, чтобы перенести ник из неё в старый
-- профиль, — и получил «ник уже указан в другом профиле»: правило
-- уникальности (097) считало и отклонённые профили. Отклонение терминально
-- (proxy.ts не пускает такой профиль никуда), уведомлений он не получает,
-- поэтому ник за ним держать незачем. Данные заявки при этом не стираются:
-- ник остаётся в карточке отклонённого профиля, просто не в счёт.
-- Webhook /start тоже ищет только неотклонённых
-- (lib/notifications/telegram-username.ts).

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
    and p.moderation_status <> 'rejected'
    and p.id is distinct from p_exclude_id
    and (lower(p.telegram_username) = lower(p_username)
         or lower(p.parent_telegram_username) = lower(p_username))
  limit 1
$$;

revoke all on function public.telegram_username_holder(text, uuid) from public, anon, authenticated;

create or replace function public.profiles_telegram_username_unique()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nick text;
begin
  -- удалённый и отклонённый профиль ник не занимает — проверять нечего
  if new.deleted_at is not null or new.moderation_status = 'rejected' then
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

-- Проверка срабатывает и при смене статуса/восстановлении: если отклонённый
-- или удалённый профиль вернуть в строй, а его ник за это время занял
-- другой, возврат упадёт с той же понятной ошибкой, а не создаст дубль.
drop trigger if exists trg_profiles_telegram_username_unique on public.profiles;
create trigger trg_profiles_telegram_username_unique
  before insert or update of telegram_username, parent_telegram_username, moderation_status, deleted_at
  on public.profiles
  for each row execute function public.profiles_telegram_username_unique();
