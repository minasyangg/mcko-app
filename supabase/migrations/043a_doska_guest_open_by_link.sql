-- 043A: doska_guest_open_by_link
--
-- Файл восстановлен 2026-11-12 из истории миграций базы
-- (supabase_migrations.schema_migrations, версия 20260815065312): миграция была
-- применена, но в репозиторий не попала. Текст ниже — дословно из истории.

-- Вход гостя по самой ссылке на доску.
--
-- Раньше пропуском был отдельный токен, а он выпускался только кнопкой
-- «Копировать» в окне доступа. Учитель включал гостевой доступ, отправлял
-- обычную ссылку на доску — и человека уводило на вход, потому что токена не
-- было. Настройка стояла, а работать не работала.
--
-- Теперь пропуском служит сам адрес доски: он и так неугадываем (b плюс десять
-- знаков), и именно его учитель отправляет. Прежний способ с токеном оставлен —
-- выданные ссылки продолжают работать.
--
-- Отдаём только то, что нужно для входа, и только если владелец гостевой доступ
-- включил: security definer здесь ровно за этим.
create or replace function public.doska_guest_open_link(p_board_id text)
returns table(board_id text, title text, access text, object_edit_policy text, locked boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select b.id, b.title, b.guest_access, b.object_edit_policy, b.locked
  from doska_boards b
  where b.id = p_board_id
    and b.deleted_at is null
    and b.guest_access in ('view','edit')
$function$;

comment on function public.doska_guest_open_link(text) is
  'Вход гостя по адресу доски, если владелец включил гостевой доступ.';
