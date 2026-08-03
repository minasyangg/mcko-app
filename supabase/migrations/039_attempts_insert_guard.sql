-- ============================================================
-- 039_attempts_insert_guard.sql
-- RLS: ученик начинает попытку только по доступному и НЕ завершённому назначению
-- ============================================================
--
-- Проблема. Политика «attempts: student manage own» была `for all using
-- (student_id = auth.uid())` без WITH CHECK, то есть на вставке проверялся
-- ровно один факт: строка про меня. Ни принадлежности назначения ученику, ни
-- лимита попыток, ни завершения назначения (миграция 038) RLS не проверяла —
-- всё это жило только в серверном компоненте app/student/attempt/[id]/page.tsx.
--
-- Страница — единственное место, где попытка создаётся легитимно, но она не
-- является границей безопасности: у браузера ученика есть его JWT и публичный
-- anon-ключ, поэтому строку в attempts можно вставить запросом к REST напрямую,
-- минуя страницу, а дальше сохранять ответы и сдавать работу обычными API
-- (они проверяют владение попыткой и её статус, но не закрытие назначения).
-- Так обходились и «тест завершён после полного балла», и принудительное
-- завершение учителем: накопительный итог берёт MAX по заданию среди всех
-- попыток, значит лишняя попытка может только поднять балл.
--
-- Решение: перенести условие в WITH CHECK на INSERT. SELECT/UPDATE/DELETE
-- остаются прежними — сужаем ровно ту операцию, где была дыра.

-- Можно ли ученику начать попытку по этому назначению?
-- security definer: предикат читает assignments/group_members/
-- student_final_results, к которым у сессии ученика нет прямого доступа
-- (и был бы риск рекурсии политик).
create or replace function check_attempt_startable(p_assignment_id uuid, p_student_id uuid)
returns boolean as $$
  select
    -- назначение адресовано этому ученику (лично или через группу)
    -- и не завершено «для всех»
    exists (
      select 1 from assignments a
      where a.id = p_assignment_id
        and a.closed_at is null
        and (
          a.student_id = p_student_id
          or exists (
            select 1 from group_members gm
            where gm.group_id = a.group_id and gm.user_id = p_student_id
          )
        )
    )
    -- и не завершено персонально: полный балл, исчерпанные попытки или
    -- решение учителя (student_final_results.closed_reason, миграция 038)
    and not exists (
      select 1 from student_final_results sfr
      where sfr.assignment_id = p_assignment_id
        and sfr.student_id = p_student_id
        and sfr.closed_reason is not null
    )
$$ language sql security definer stable set search_path = public;

comment on function check_attempt_startable(uuid, uuid) is
  'Предикат RLS для вставки в attempts: назначение адресовано ученику и не завершено (ни целиком, ни персонально). Единственный легитимный автор попыток — app/student/attempt/[id]/page.tsx, там же те же условия проверяются для UI.';

-- Разбираем «manage own» на операции: дыра была только во вставке.
drop policy if exists "attempts: student manage own" on attempts;

create policy "attempts: student reads own" on attempts
  for select using (student_id = auth.uid());

create policy "attempts: student updates own" on attempts
  for update
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

-- DELETE сохраняем как было: удаление своей попытки больше не возвращает
-- ученику попытку (счётчик и факт завершения живут в student_final_results,
-- куда сессия ученика не пишет — политики записи сняты в 032), поэтому
-- сужать эту операцию сейчас нечего.
create policy "attempts: student deletes own" on attempts
  for delete using (student_id = auth.uid());

create policy "attempts: student starts own" on attempts
  for insert
  with check (
    student_id = auth.uid()
    and check_attempt_startable(assignment_id, student_id)
  );
