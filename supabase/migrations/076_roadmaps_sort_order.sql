-- Ручной порядок программ (roadmaps) внутри группы по предмету —
-- пользователь: «сделай так чтобы пользователь мог самостоятельно
-- сортировку и их порядок установить мышью перетаскиванием».
--
-- sort_order — per-teacher (не глобальный): один учитель не должен видеть,
-- как перестановка карточек влияет на нумерацию у другого. Начальное
-- заполнение — по created_at (тот же порядок, что показывался раньше),
-- чтобы существующий список не «прыгнул» при первом открытии после деплоя.

alter table roadmaps add column if not exists sort_order integer;

with ranked as (
  select id, row_number() over (partition by created_by order by created_at asc) as rn
  from roadmaps
)
update roadmaps r
set sort_order = ranked.rn
from ranked
where r.id = ranked.id and r.sort_order is null;

alter table roadmaps alter column sort_order set default 0;
alter table roadmaps alter column sort_order set not null;

create index if not exists roadmaps_created_by_sort_order_idx on roadmaps (created_by, sort_order);
