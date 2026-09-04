-- Модерация самостоятельной регистрации.
--
-- Раньше публичная регистрация (/register) сразу создавала рабочий аккаунт
-- ученика: триггер handle_new_user писал профиль с ролью student, и человек
-- немедленно попадал в систему. По решению пользователя регистрация
-- сохраняется, но результат теперь ждёт подтверждения админом — именно админ
-- выставляет роль, организацию и прочие метаданные.

-- Статус модерации. 'approved' по умолчанию — иначе все существующие
-- профили (заведённые админом вручную) разом стали бы непроверенными.
alter table profiles add column if not exists moderation_status text not null default 'approved'
  check (moderation_status in ('pending', 'approved', 'rejected'));

-- Контакт для связи с заявителем. При самостоятельной регистрации обязателен
-- хотя бы один: telegram уже есть отдельной колонкой, здесь — телефон, а
-- email хранится в profiles.email.
alter table profiles add column if not exists phone text;

-- Согласие на обработку персональных данных (152-ФЗ): фиксируем сам факт и
-- момент — согласие должно быть доказуемым, поэтому это отметка времени, а не
-- булев флаг.
alter table profiles add column if not exists pd_consent_at timestamptz;

alter table profiles add column if not exists moderation_note text;
alter table profiles add column if not exists moderated_by uuid references profiles(id);
alter table profiles add column if not exists moderated_at timestamptz;

create index if not exists profiles_moderation_idx on profiles(moderation_status)
  where moderation_status = 'pending';

-- Триггер: самостоятельная регистрация создаёт профиль СРАЗУ на модерации.
-- Отличаем её от заведения админом по метаданным: серверный роут создания
-- пользователя передаёт self_signup=false (см. app/api/admin/users).
create or replace function handle_new_user()
returns trigger as $$
declare
  v_self boolean := coalesce((new.raw_user_meta_data->>'self_signup')::boolean, false);
begin
  insert into public.profiles (
    id, full_name, role, email,
    telegram_username, phone,
    moderation_status, pd_consent_at
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'User'),
    'student',
    new.email,
    nullif(new.raw_user_meta_data->>'telegram_username', ''),
    nullif(new.raw_user_meta_data->>'phone', ''),
    case when v_self then 'pending' else 'approved' end,
    case when v_self then now() else null end
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

comment on column profiles.moderation_status is
  'pending — заявка с публичной регистрации ждёт подтверждения админом; approved — рабочий аккаунт; rejected — отклонён.';
comment on column profiles.pd_consent_at is
  'Момент согласия на обработку персональных данных (152-ФЗ), проставляется при самостоятельной регистрации.';
