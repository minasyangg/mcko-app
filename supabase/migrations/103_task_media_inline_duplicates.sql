-- 103: рисунок задания показывался ученику дважды — над условием и в нём.
--
-- Импорт библиотеки (d:\vpr-downloader\import_to_db.py) записывал каждую
-- картинку задачи вложением library_problem_media с placement 'above_text',
-- хотя та же картинка уже стояла ссылкой в prompt_html. При переносе задачи
-- в ДЗ (lib/tests/add-problem-to-version.ts, скил homework-agent-build)
-- вложение копировалось в task_media с тем же placement, и плеер
-- (TaskImageGallery) рисовал его над условием, а MarkdownContent — ещё раз
-- внутри. На 2026-10-14: 167 таких вложений в 95 заданиях ДЗ, 32 550 в
-- библиотеке.
--
-- Лечение — placement 'inline' (плеер, предпросмотр и печать такие
-- отдельно не показывают; рисунок остаётся в тексте условия). Дубль
-- узнаётся по имени файла вложения без расширения (≥ 8 символов), которое
-- встречается в ссылке library-media/… в prompt_html; у заданий ФИПИ имя в
-- тексте длиннее (…_087b03d9e86a3397.jpg против …_087b03d9e86a.jpg), поэтому
-- сравнение «содержится», а не «равно».
--
-- Осторожность: в банке ФИПИ часть «картинок» — сохранённые страницы 404
-- (≈278 байт). Если копия в тексте битая (< 1000 байт), а вложение целое —
-- вложение остаётся видимым, иначе ученик потерял бы единственный рабочий
-- рисунок. Если битое само вложение — прятать его не жалко.
--
-- Откат: до миграции 'inline' в обеих таблицах не было ни одной строки
-- (task_media: 559 above_text; library_problem_media: 33 226 above_text и
-- 13 334 solution), поэтому
--   update public.task_media set placement = 'above_text' where placement = 'inline';
--   update public.library_problem_media set placement = 'above_text' where placement = 'inline';
-- (строки, ставшие 'inline' позже через add-problem-to-version/импорт, при
-- таком откате тоже вернутся к above_text — снова дубль, но не потеря).

with mm as (
  select m.id, m.storage_path, t.prompt_html,
         regexp_replace(split_part(m.storage_path, '/', -1), '\.[a-z0-9]+$', '', 'i') as base
  from public.task_media m
  join public.test_tasks t on t.id = m.task_id
  where coalesce(m.placement, 'above_text') in ('above_text', 'below_text')
    and t.prompt_html is not null
), d as (
  select mm.*, (regexp_match(mm.prompt_html, 'library-media/([^ )"]*' || mm.base || '[^ )"]*)'))[1] as prompt_path
  from mm
  where length(mm.base) >= 8 and position(mm.base in mm.prompt_html) > 0
), s as (
  select d.id,
         coalesce((po.metadata->>'size')::int, 0) >= 1000 as prompt_ok,
         coalesce((mo.metadata->>'size')::int, 0) >= 1000 as media_ok
  from d
  left join storage.objects po on po.bucket_id = 'library-media' and po.name = d.prompt_path
  left join storage.objects mo on mo.bucket_id = 'task-media' and mo.name = d.storage_path
)
update public.task_media m
set placement = 'inline'
from s
where m.id = s.id and (s.prompt_ok or not s.media_ok);

with mm as (
  select m.id, m.storage_path, p.prompt_html,
         regexp_replace(split_part(m.storage_path, '/', -1), '\.[a-z0-9]+$', '', 'i') as base
  from public.library_problem_media m
  join public.library_problems p on p.id = m.library_problem_id
  where coalesce(m.placement, 'above_text') in ('above_text', 'below_text')
    and p.prompt_html is not null
), d as (
  select mm.*, (regexp_match(mm.prompt_html, 'library-media/([^ )"]*' || mm.base || '[^ )"]*)'))[1] as prompt_path
  from mm
  where length(mm.base) >= 8 and position(mm.base in mm.prompt_html) > 0
), s as (
  select d.id,
         coalesce((po.metadata->>'size')::int, 0) >= 1000 as prompt_ok,
         coalesce((mo.metadata->>'size')::int, 0) >= 1000 as media_ok
  from d
  left join storage.objects po on po.bucket_id = 'library-media' and po.name = d.prompt_path
  left join storage.objects mo on mo.bucket_id = 'library-media' and mo.name = d.storage_path
)
update public.library_problem_media m
set placement = 'inline'
from s
where m.id = s.id and (s.prompt_ok or not s.media_ok);
