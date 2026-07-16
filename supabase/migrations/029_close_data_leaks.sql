-- 029: аудит связей БД (пользователи/задания/тесты/результаты) — закрываем
-- найденные утечки и дыры целостности, обнаруженные RLS-инвентаризацией по
-- всем предыдущим миграциям.

-- ── 1. library_problems / library_problem_media / book_problems ────────────
-- Хранят correct_answer/solution_html прямо в строке. SELECT-политика
-- проверяла только auth.role()='authenticated' (+ org) — БЕЗ проверки роли,
-- то есть любой студент мог прочитать ответ напрямую через PostgREST, в обход
-- всей защиты task_answer_keys/task_solutions (которая закрыта от студентов
-- корректно). Ни одна фича не читает эти таблицы со стороны ученика —
-- сужаем чтение до teacher/admin, как и весь остальной контент задач.
drop policy if exists "library_problems: read global or own org" on library_problems;
create policy "library_problems: read global or own org" on library_problems
  for select
  using (
    auth_role() in ('teacher','admin')
    and (organization_id is null or organization_id = auth_org())
  );

drop policy if exists "library_problem_media: read for all authenticated" on library_problem_media;
create policy "library_problem_media: read for teacher/admin" on library_problem_media
  for select
  using (auth_role() in ('teacher','admin'));

drop policy if exists "book_problems: read via book" on book_problems;
create policy "book_problems: read via book" on book_problems
  for select
  using (
    auth_role() in ('teacher','admin')
    and book_id in (
      select id from books
      where organization_id is null or organization_id = auth_org()
    )
  );

-- ── 2. solution_requests: студент мог сам себя «одобрить» ──────────────────
-- Политика "student manage own" была FOR ALL по владению строкой, без
-- WITH CHECK на status — студент мог напрямую (в обход API-роута с
-- проверкой роли) update-нуть свою заявку в status='approved' и прочитать
-- решение до проверки/одобрения учителем. Оставляем студенту только
-- чтение и создание заявки; approve/reject — исключительно teacher/admin
-- (их политики не менялись).
drop policy if exists "solution_requests: student manage own" on solution_requests;
create policy "solution_requests: student read own" on solution_requests
  for select using (student_id = auth.uid());
create policy "solution_requests: student insert own" on solution_requests
  for insert with check (student_id = auth.uid());

-- ── 3. attempt_task_answers: студент мог сам себя «проверить» ──────────────
-- "student manage own" — FOR ALL по владению попыткой, без ограничения по
-- колонкам: в обход API можно было напрямую выставить себе is_correct=true/
-- awarded_score=max/is_locked=true. Легитимный флоу (сохранение черновика
-- ответа через app/api/attempts/[id]/answers) этих полей не трогает —
-- триггер их не блокирует. Перенос оценок с предыдущей попытки (carry
-- forward при повторной сдаче) теперь идёт через service-role клиент
-- (см. app/student/attempt/[id]/page.tsx), которого auth.uid() is null не
-- касается.
create or replace function prevent_student_self_grading()
returns trigger as $$
begin
  if auth.uid() is not null then
    if TG_OP = 'INSERT' then
      if NEW.is_correct is not null or NEW.awarded_score is not null or NEW.is_locked is true then
        raise exception 'Оценка выставляется только при проверке задания';
      end if;
    elsif TG_OP = 'UPDATE' then
      if NEW.is_correct is distinct from OLD.is_correct
         or NEW.awarded_score is distinct from OLD.awarded_score
         or NEW.is_locked is distinct from OLD.is_locked then
        raise exception 'Оценка выставляется только при проверке задания';
      end if;
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.prevent_student_self_grading() from anon, authenticated, public;

drop trigger if exists trg_prevent_student_self_grading on attempt_task_answers;
create trigger trg_prevent_student_self_grading
  before insert or update on attempt_task_answers
  for each row execute function prevent_student_self_grading();

-- ── 4. attempts: студент мог сам себе выставить статус/балл ─────────────────
-- "student manage own" — тоже FOR ALL без ограничения по колонкам: в обход
-- API можно было выставить status='checked'/'submitted' и произвольный
-- score/max_score напрямую. Легитимные прямые записи студента — создание
-- попытки (status='in_progress', score/max_score всегда null) и переход
-- not_started→in_progress; реальная сдача/проверка идёт через
-- lib/grading/finalize.ts и app/api/attempts/[id]/grade (service role).
create or replace function prevent_student_self_attempt_status()
returns trigger as $$
begin
  if auth.uid() is not null then
    if NEW.status not in ('not_started','in_progress') then
      raise exception 'Статус попытки меняется только через сдачу/проверку';
    end if;
    if NEW.score is not null or NEW.max_score is not null then
      raise exception 'Балл выставляется только при проверке';
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.prevent_student_self_attempt_status() from anon, authenticated, public;

drop trigger if exists trg_prevent_student_self_attempt_status on attempts;
create trigger trg_prevent_student_self_attempt_status
  before insert or update on attempts
  for each row execute function prevent_student_self_attempt_status();

-- ── 5. profiles: самостоятельная смена organization_id/created_by/is_active ─
-- Триггер prevent_role_change (018) блокировал только смену role. Колонки
-- organization_id/created_by/is_active ничем не были защищены — пользователь
-- мог сам себе поменять organization_id на чужую организацию и через
-- "organizations: members read own" прочитать её settings. Расширяем тот же
-- триггер (уже применяется к каждому update profiles).
create or replace function prevent_role_change()
returns trigger as $$
begin
  if auth.uid() is not null then
    if NEW.role is distinct from OLD.role then
      raise exception 'Изменение роли недоступно';
    end if;
    if NEW.organization_id is distinct from OLD.organization_id then
      raise exception 'Изменение организации недоступно';
    end if;
    if NEW.created_by is distinct from OLD.created_by then
      raise exception 'Изменение привязки к учителю недоступно';
    end if;
    if NEW.is_active is distinct from OLD.is_active then
      raise exception 'Изменение статуса активности недоступно';
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;
