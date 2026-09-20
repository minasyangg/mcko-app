-- Отзыв права вызова функций у роли anon (незалогиненный посетитель —
-- публичный ключ Supabase лежит в JS страницы, вызвать RPC может кто угодно
-- из интернета).
--
-- Postgres по умолчанию выдаёт EXECUTE роли PUBLIC на каждую новую функцию,
-- а Supabase дополнительно гранит anon/authenticated — поэтому anon оказался
-- в ACL у всех функций проекта, независимо от того, что просила миграция.
-- В 083 стояло `grant execute ... to authenticated, service_role`, но
-- предшествующий `revoke ... from public` не снимает грант, выданный роли
-- поимённо — anon остался.
--
-- Отзываем точечно там, где это действительно важно. Триггерные функции и
-- boolean-хелперы RLS (check_*) не трогаем: первые вызываются только
-- движком триггеров, вторые возвращают boolean об уже известном вызывающему
-- id и используются внутри самих политик (снятие гранта у anon для них
-- ничего не даёт, а ошибка в списке сломала бы RLS).

-- ── 1. Функции, ИЗМЕНЯЮЩИЕ данные в обход RLS ────────────────────────────
-- security definer + insert в group_members. Анонимный вызов с двумя
-- известными UUID дописывал учеников в группы программ мимо всех политик
-- (exists-проверка по teacher_students сужала эффект, но не закрывала его).
-- Вызываются только из триггеров и из серверного кода под service_role —
-- ни anon, ни authenticated напрямую они не нужны.
revoke execute on function public.sync_group_to_roadmaps(uuid) from anon, authenticated;
revoke execute on function public.sync_student_to_roadmaps_from_group(uuid, uuid) from anon, authenticated;
-- У этих двух в ACL был ещё и грант роли PUBLIC (`=X/postgres`), в которую
-- входит anon — без его снятия отзыв у anon поимённо ничего не меняет.
revoke execute on function public.sync_group_to_roadmaps(uuid) from public;
revoke execute on function public.sync_student_to_roadmaps_from_group(uuid, uuid) from public;

-- ── 2. Функции, ВОЗВРАЩАЮЩИЕ данные ──────────────────────────────────────
-- security invoker, поэтому RLS на attempts/attempt_task_answers и сейчас
-- отдаёт анонимному ноль строк — утечки нет. Право всё равно лишнее:
-- функция агрегирует ошибки учеников, и если её когда-нибудь переведут в
-- security definer «чтобы работала из cron», грант у anon превратится в
-- утечку чужой статистики.
revoke execute on function public.diagnose_roadmap_mistakes(uuid, integer) from anon;

-- Статистика по книгам — тот же случай: invoker + RLS, но anon ни к одной
-- книге отношения не имеет.
revoke execute on function public.book_problem_stats() from anon;

-- ── Намеренно НЕ отзываем ────────────────────────────────────────────────
-- doska_guest_open / doska_guest_open_link — гостевой вход на доску по
-- ссылке работает БЕЗ логина, вызов ролью anon здесь штатный (проект doska).
-- auth_role() / auth_org() — читают JWT текущего вызывающего; у anon
-- возвращают null, используются внутри RLS-политик.
