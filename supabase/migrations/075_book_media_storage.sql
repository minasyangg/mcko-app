-- Хранение изображений внутри заданий книг (иллюстрации, чертежи, графики).
-- До этой миграции book-import.mjs оставлял <img src="..."> ссылками на
-- временный подписанный URL PaddleOCR (bcebos) — они истекают, поэтому
-- картинки нужно перезалить в собственный публичный бакет, как это уже
-- сделано для library-media (задачи из библиотеки).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'book-media',
  'book-media',
  true,
  10485760, -- 10MB per image
  array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
on conflict (id) do nothing;

comment on column books.cover_image_path is 'Путь в bucket book-media к обложке книги (если есть). NULL — обложка не задана.';

-- Публичный бакет отдаёт объекты по прямому URL без RLS-политики на select
-- (см. library-media, миграция 017_security_fixes — широкая select-политика
-- там была лишь листингом всех файлов и была снята намеренно). Заливка идёт
-- только из скрипта импорта под service_role, поэтому отдельная insert-политика
-- не нужна — service_role проходит RLS насквозь.
