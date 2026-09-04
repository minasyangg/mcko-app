-- «Что этот учитель уже задавал этому ученику» — источник правды для
-- предупреждений о повторах при сборке ДЗ.
--
-- Смысл: одна и та же задача из книги/библиотеки попадала ученику в разные ДЗ,
-- и учителю это было никак не видно (найден живой случай: задача книги в двух
-- разных ДЗ у одного ученика). Запрещать повтор не нужно — осознанное
-- повторение это нормальный приём, — поэтому представление только сообщает
-- факт, а решение остаётся за учителем.
--
-- Границы, заданные пользователем:
--   • учитываются ДЗ ТОЛЬКО того же учителя (у ученика может быть второй
--     преподаватель, его задания сюда не попадают);
--   • горизонт памяти — 11 месяцев (задача годовой давности это уже
--     полезное повторение, а не дубль);
--   • только задачи со ссылкой на источник (book_problem_id /
--     library_problem_id). Импортированные из PDF задачи связи с источником
--     не имеют и в дедупликации не участвуют по определению.
--
-- Групповые назначения раскрываются в участников группы: иначе «задавали
-- всему классу» не было бы видно у конкретного ученика.
create or replace view assigned_problems as
select
  coalesce(a.student_id, gm.user_id)                as student_id,
  t.created_by                                      as teacher_id,
  tt.book_problem_id,
  tt.library_problem_id,
  -- единый ключ задачи независимо от источника — по нему и сравниваем
  coalesce(tt.book_problem_id, tt.library_problem_id) as problem_id,
  t.id                                              as test_id,
  t.title                                           as test_title,
  t.kind                                            as test_kind,
  a.id                                              as assignment_id,
  a.created_at                                      as assigned_at
from test_tasks tt
join test_versions tv on tv.id = tt.test_version_id
join tests         t  on t.id  = tv.test_id
join assignments   a  on a.test_version_id = tv.id
left join group_members gm on gm.group_id = a.group_id
where (tt.book_problem_id is not null or tt.library_problem_id is not null)
  and coalesce(a.student_id, gm.user_id) is not null
  and a.created_at > now() - interval '11 months';

comment on view assigned_problems is
  'Задачи из книг/библиотеки, уже заданные ученику этим же учителем за последние 11 месяцев. Используется для предупреждения о повторах при сборке ДЗ (не запрет).';

-- Представление наследует RLS базовых таблиц (security_invoker), поэтому
-- учитель через него видит ровно то, что видит в самих tests/assignments.
alter view assigned_problems set (security_invoker = true);
