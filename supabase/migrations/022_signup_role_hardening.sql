-- Аудит: публичный signUp позволял передать role='teacher' (или любую) в
-- user_metadata — триггер слепо копировал её в profiles. Anon key публичный,
-- форма — не защита. Теперь самостоятельная регистрация ВСЕГДА создаёт
-- ученика; роли teacher/admin выставляют только серверные admin-роуты
-- (create-teacher и т.п.) отдельным UPDATE через service role — он проходит
-- prevent_role_change (auth.uid() null).
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'User'),
    'student'
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;
