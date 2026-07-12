-- Email в profiles: раньше страницы админа тянули email для каждого
-- пользователя из Auth Admin API (listUsers/getUserById). Храним копию в
-- profiles: заполняется триггером при регистрации и бэкфиллом; при смене
-- email через админ-роут синхронизируется тем же роутом (service role).
-- Видимость наследует RLS profiles (admin org / teacher свои ученики / сам).
alter table profiles add column if not exists email text;

update profiles p set email = u.email
from auth.users u
where u.id = p.id and p.email is distinct from u.email;

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'User'),
    'student',                       -- роль из metadata игнорируется (022)
    new.email
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;
