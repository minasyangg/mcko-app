-- Мягкое удаление тестов: результаты сдававших учеников не должны пропадать.
--
-- Как было: DELETE /api/tests/[id] стирал тест физически и по дороге удалял
-- attempts и attempt_task_answers сдававших. Статистика ученика после этого
-- становилась неполной — «сдавал, а результата нет».
--
-- Плюс каскад в самой схеме: student_final_results ссылается на
-- test_versions с ON DELETE CASCADE, то есть физическое удаление теста
-- уносит и накопительные итоги.
--
-- Решение (вариант «А», выбран пользователем):
--   • тест, который НИКТО не решал, удаляется физически — терять нечего;
--   • тест, по которому есть попытки, помечается deleted_at и исчезает из
--     интерфейса, но строки остаются: и попытки, и ответы, и итоги.
alter table tests add column if not exists deleted_at timestamptz;

create index if not exists tests_not_deleted_idx on tests(organization_id)
  where deleted_at is null;

comment on column tests.deleted_at is
  'Мягкое удаление: тест скрыт из интерфейса, но результаты сдававших учеников сохранены. NULL — обычный активный тест.';

-- RLS: скрытый тест не должен возвращаться обычными запросами. Политики
-- переписываем с добавлением условия, сохраняя прежний скоуп (организация +
-- владение), чтобы не расширить доступ по недосмотру.
-- Условия скопированы с действующих политик один в один, добавлено только
-- "deleted_at is null". У учителя намеренно НЕТ проверки организации — так
-- было и раньше (владение по created_by), и добавлять её здесь нельзя:
-- это молча отрезало бы доступ там, где он работал.
drop policy if exists "tests: teacher manage own" on tests;
create policy "tests: teacher manage own" on tests
  for all
  using (
    deleted_at is null
    and auth_role() = 'teacher'
    and created_by = auth.uid()
  );

drop policy if exists "tests: admin manage org" on tests;
create policy "tests: admin manage org" on tests
  for all
  using (
    deleted_at is null
    and auth_role() = 'admin'
    and organization_id = auth_org()
  );

-- Ученик: скрытый тест не показываем даже по действующему назначению —
-- иначе удалённый тест остался бы видимым в его кабинете.
drop policy if exists "tests: student read published via assignment" on tests;
create policy "tests: student read published via assignment" on tests
  for select
  using (
    deleted_at is null
    and auth_role() = 'student'
    and student_has_test_assignment(id)
  );
