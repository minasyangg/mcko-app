-- Живой подсчёт заданий/ответов на книгу для каталога /teacher/books.
-- Раньше счётчики брались из books.import_meta (снимок на момент импорта PDF)
-- и не учитывали ответы, добавленные позже (кнопка «Ответ ИИ»,
-- book-answer-reviewer, ручной ввод). Замена на select('book_id, answer_source')
-- по всей таблице book_problems тоже оказалась неверной: PostgREST молча режет
-- ответ по project-wide лимиту строк (Max Rows), а без фильтра по book_id
-- запрос читает все книги разом (8000+ строк) — конкретной книге может
-- достаться обрезанный кусок вместо её реальных заданий.
-- Функция считает агрегаты в БД (по одной строке на книгу — лимит строк
-- никогда не задевается) и вызывается через supabase.rpc(). security invoker
-- (по умолчанию) — функция выполняется с правами и RLS вызывающей роли, так
-- что подсчитываются только задания книг, видимых текущему пользователю
-- (см. политику "book_problems: read via book" в 016_books_module.sql).
create or replace function public.book_problem_stats()
returns table (book_id uuid, total bigint, answered bigint)
language sql
stable
as $$
  select
    book_id,
    count(*) as total,
    count(*) filter (where answer_source <> 'none') as answered
  from book_problems
  where is_active = true
  group by book_id;
$$;

revoke all on function public.book_problem_stats() from public;
grant execute on function public.book_problem_stats() to authenticated;
