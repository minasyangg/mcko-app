-- ============================================================
-- 041_doska_boards.sql
-- Доски (отдельное приложение doska) получают полноценную модель владения,
-- участников и доступа. Аддитивно: ничего существующего не меняется.
--
-- Что было не так. 037 завёл doska_student_boards с unique (teacher_id,
-- student_id) — ровно одна вечная доска на пару, то есть «списка досок» у
-- учителя не существовало в принципе. Параллельно сама doska держала свой
-- файловый индекс (data/index/sha256(user_id).json) с теми же метаданными:
-- два источника правды, расходящиеся при любой ошибке записи. А доступ
-- ученика был просто ссылкой без личности — открыть её и рисовать мог кто
-- угодно, кому её переслали.
--
-- Что теперь. Источник правды по метаданным и правам — эти три таблицы.
-- Содержимое доски (объекты) и загруженные картинки остаются в файловом
-- хранилище doska: класть холст в Postgres незачем, он меняется десятки раз
-- в секунду и никем, кроме самой доски, не читается. Здесь — только то, по
-- чему нужно искать, разграничивать и показывать списки.
--
-- Роли берутся из mcko-app без дублирования: владелец — учитель, участники —
-- его ученики (проверяется существующим check_student_owned_by_auth из 019),
-- админ организации получает SELECT и ничего больше. Гость — единственный,
-- у кого нет строки в profiles; он входит по ссылке с токеном, и только если
-- владелец эту ссылку явно включил.
--
-- doska_student_boards НЕ удаляется: её три строки переносятся ниже, сама
-- таблица остаётся со своими политиками и помечается устаревшей.
-- ============================================================

-- ── 1. Таблицы ──────────────────────────────────────────────

-- id — собственный короткий идентификатор doska ('b' + 10 случайных символов),
-- а не uuid: он уже разошёлся по ссылкам и лежит в именах каталогов на диске.
create table if not exists doska_boards (
  id                 text primary key check (id ~ '^[A-Za-z0-9_-]{1,40}$'),
  owner_id           uuid not null references profiles(id) on delete cascade,
  title              text not null default 'Новая доска'
                       check (char_length(title) between 1 and 80),
  -- гостевая ссылка: 'none' — вход только по аккаунту mcko-app (по умолчанию)
  guest_access       text not null default 'none'
                       check (guest_access in ('none','view','edit')),
  -- кто может удалять чужие объекты: 'creator' — только автор (владелец всегда)
  object_edit_policy text not null default 'creator'
                       check (object_edit_policy in ('creator','anyone')),
  -- глобальный «запретить рисовать» на время объяснения
  locked             boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- удаление мягкое: содержимое на диске doska чистится отдельно
  deleted_at         timestamptz
);
create index if not exists idx_doska_boards_owner on doska_boards(owner_id);

create table if not exists doska_board_participants (
  board_id   text not null references doska_boards(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  access     text not null default 'edit' check (access in ('edit','view')),
  added_by   uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);
-- board_id — ведущая колонка PK, отдельный индекс на него не нужен
create index if not exists idx_doska_board_participants_user
  on doska_board_participants(user_id);

-- Токен гостевой ссылки вынесен из doska_boards намеренно: у админа
-- организации есть SELECT на всю строку доски, и лежи токен там, админ
-- прочитал бы его и вошёл по edit-ссылке — то есть право чтения поднялось бы
-- до права записи. Здесь политика только для владельца.
create table if not exists doska_board_guest_links (
  board_id   text primary key references doska_boards(id) on delete cascade,
  token      text not null unique check (char_length(token) between 16 and 64),
  created_at timestamptz not null default now()
);

-- update_updated_at() уже есть с 001 (search_path закреплён в 017)
drop trigger if exists doska_boards_updated_at on doska_boards;
create trigger doska_boards_updated_at
  before update on doska_boards
  for each row execute function update_updated_at();

-- ── 2. Хелперы ──────────────────────────────────────────────
-- security definer, чтобы политики одной таблицы могли смотреть в другую
-- и не сваливаться в рекурсию RLS — тот же приём, что в 004 и 018.

create or replace function doska_board_is_owner(p_board_id text)
returns boolean as $$
  select exists (
    select 1 from doska_boards b
    where b.id = p_board_id and b.owner_id = auth.uid()
  )
$$ language sql security definer stable set search_path = public;

create or replace function doska_board_is_participant(p_board_id text)
returns boolean as $$
  select exists (
    select 1 from doska_board_participants p
    where p.board_id = p_board_id and p.user_id = auth.uid()
  )
$$ language sql security definer stable set search_path = public;

-- Доска принадлежит учителю из организации текущего пользователя?
create or replace function doska_board_in_auth_org(p_board_id text)
returns boolean as $$
  select exists (
    select 1 from doska_boards b
    join profiles p on p.id = b.owner_id
    where b.id = p_board_id and p.organization_id = auth_org()
  )
$$ language sql security definer stable set search_path = public;

-- EXECUTE у этих трёх намеренно НЕ отбирается — как у auth_role()/auth_org()
-- в 017. Их зовут сами политики, и если снять право у anon, то select из
-- doska_boards под анонимом падает с «permission denied for function», а не
-- отдаёт пустой результат. Утечки нет: у анонима auth.uid() и auth_org()
-- равны null, поэтому все три всегда возвращают false.

-- ── 3. RLS: doska_boards ────────────────────────────────────

alter table doska_boards enable row level security;

-- Владелец видит и свои удалённые: иначе мягкое удаление не смогло бы
-- прочитать строку назад после апдейта.
drop policy if exists "doska_boards: owner reads own" on doska_boards;
create policy "doska_boards: owner reads own" on doska_boards
  for select using (owner_id = auth.uid());

drop policy if exists "doska_boards: participant reads" on doska_boards;
create policy "doska_boards: participant reads" on doska_boards
  for select using (deleted_at is null and doska_board_is_participant(id));

drop policy if exists "doska_boards: admin reads org" on doska_boards;
create policy "doska_boards: admin reads org" on doska_boards
  for select using (
    auth_role() = 'admin'
    and deleted_at is null
    and exists (
      select 1 from profiles p
      where p.id = doska_boards.owner_id and p.organization_id = auth_org()
    )
  );

drop policy if exists "doska_boards: teacher creates own" on doska_boards;
create policy "doska_boards: teacher creates own" on doska_boards
  for insert with check (auth_role() = 'teacher' and owner_id = auth.uid());

-- with check повторяет using — иначе владелец мог бы переписать owner_id
-- на чужой и подарить доску вместе со всем содержимым.
drop policy if exists "doska_boards: owner updates own" on doska_boards;
create policy "doska_boards: owner updates own" on doska_boards
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Политики delete нет вовсе: удаление только мягкое, через deleted_at.

-- ── 4. RLS: doska_board_participants ────────────────────────

alter table doska_board_participants enable row level security;

drop policy if exists "doska_participants: reads own" on doska_board_participants;
create policy "doska_participants: reads own" on doska_board_participants
  for select using (user_id = auth.uid());

drop policy if exists "doska_participants: owner reads board" on doska_board_participants;
create policy "doska_participants: owner reads board" on doska_board_participants
  for select using (doska_board_is_owner(board_id));

drop policy if exists "doska_participants: admin reads org" on doska_board_participants;
create policy "doska_participants: admin reads org" on doska_board_participants
  for select using (auth_role() = 'admin' and doska_board_in_auth_org(board_id));

-- check_student_owned_by_auth (019) — учитель может добавить только своего
-- ученика. Проверяет БД, а не doska: доске незачем знать про teacher_students.
drop policy if exists "doska_participants: owner adds own students" on doska_board_participants;
create policy "doska_participants: owner adds own students" on doska_board_participants
  for insert with check (
    doska_board_is_owner(board_id)
    and added_by = auth.uid()
    and check_student_owned_by_auth(user_id)
  );

drop policy if exists "doska_participants: owner updates" on doska_board_participants;
create policy "doska_participants: owner updates" on doska_board_participants
  for update using (doska_board_is_owner(board_id))
         with check (doska_board_is_owner(board_id));

drop policy if exists "doska_participants: owner removes" on doska_board_participants;
create policy "doska_participants: owner removes" on doska_board_participants
  for delete using (doska_board_is_owner(board_id));

-- ── 5. RLS: doska_board_guest_links ─────────────────────────

alter table doska_board_guest_links enable row level security;

-- Только владелец. Ни участник, ни админ токен не читают.
drop policy if exists "doska_guest_links: owner manages" on doska_board_guest_links;
create policy "doska_guest_links: owner manages" on doska_board_guest_links
  for all using (doska_board_is_owner(board_id))
      with check (doska_board_is_owner(board_id));

-- ── 6. Вход гостя ───────────────────────────────────────────
-- Единственная функция, доступная anon. Перечислить доски нельзя: нужно знать
-- и id доски, и токен. Отзыв ссылки = удаление строки в doska_board_guest_links,
-- и все выданные ссылки перестают работать мгновенно.

create or replace function doska_guest_open(p_board_id text, p_token text)
returns table (
  board_id           text,
  title              text,
  access             text,
  object_edit_policy text,
  locked             boolean
) as $$
  select b.id, b.title, b.guest_access, b.object_edit_policy, b.locked
  from doska_boards b
  join doska_board_guest_links g on g.board_id = b.id
  where b.id = p_board_id
    and b.deleted_at is null
    and b.guest_access in ('view','edit')
    and g.token = p_token
$$ language sql security definer stable set search_path = public;

revoke execute on function doska_guest_open(text, text) from public;
grant  execute on function doska_guest_open(text, text) to anon, authenticated;

-- ── 7. Перенос данных из 037 ────────────────────────────────
-- Заголовок повторяет то, что ставил route.ts при создании доски.

insert into doska_boards (id, owner_id, title, created_at, updated_at)
select sb.board_id, sb.teacher_id, coalesce(nullif(p.full_name, ''), 'Доска ученика'),
       sb.created_at, sb.created_at
from doska_student_boards sb
join profiles p on p.id = sb.student_id
on conflict (id) do nothing;

insert into doska_board_participants (board_id, user_id, access, added_by, created_at)
select sb.board_id, sb.student_id, 'edit', sb.teacher_id, sb.created_at
from doska_student_boards sb
join doska_boards b on b.id = sb.board_id
on conflict (board_id, user_id) do nothing;

-- ── 8. Комментарии ──────────────────────────────────────────

comment on table doska_boards is
  'Доски приложения doska: владелец, заголовок, настройки доступа. Содержимое холста и загруженные картинки здесь НЕ хранятся — они в файловом хранилище doska.';
comment on column doska_boards.id is
  'Собственный короткий id доски (b + 10 символов), а не uuid: уже разошёлся по ссылкам и именам каталогов на диске doska.';
comment on column doska_boards.object_edit_policy is
  'creator — участник удаляет только свои объекты; anyone — любой участник любые. Владелец может всё в обоих случаях.';
comment on table doska_board_participants is
  'Кто допущен к доске и с каким уровнем. Добавлять можно только своих учеников — проверяется check_student_owned_by_auth в политике insert.';
comment on table doska_board_guest_links is
  'Токен гостевой ссылки. Вынесен из doska_boards, чтобы админ организации (у него SELECT на доску) не мог прочитать токен и войти на правах редактирования.';

comment on table doska_student_boards is
  'УСТАРЕЛО с 041_doska_boards.sql: кодом не используется. Источник правды — doska_boards и doska_board_participants, строки перенесены туда. Таблица оставлена как след миграции.';
