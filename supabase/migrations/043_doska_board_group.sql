-- Доска может быть заведена не на одного ученика, а на группу.
--
-- Само участие по-прежнему хранится строками в doska_board_participants: так
-- проверка доступа остаётся одной и той же для всех случаев, и доске не нужно
-- знать про группы вообще. Здесь запоминается лишь, откуда взялись участники,
-- чтобы показать это учителю в списке и чтобы можно было досыпать участников,
-- если состав группы поменяется.
--
-- on delete set null, а не cascade: удаление группы не должно уносить доску с
-- содержимым занятия. Доска останется, просто перестанет считаться групповой.

alter table public.doska_boards
  add column if not exists group_id uuid references public.groups(id) on delete set null;

create index if not exists doska_boards_group_idx
  on public.doska_boards(group_id) where group_id is not null;

comment on column public.doska_boards.group_id is
  'Группа, на которую заведена доска. Участники всё равно лежат в doska_board_participants.';
