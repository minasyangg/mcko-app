-- 100: бакет для картинок теории (редактор «Библиотека → Теория»).
--
-- Публичный, как book-media/library-media: теорию видят ученики, и картинка
-- в markdown — обычная ссылка ![…](url). Загрузка только через API
-- POST /api/theory/media (service role, проверка «учитель/админ»), поэтому
-- политик на запись в storage.objects нет. SVG не принимаем: картинку
-- загружает пользователь, а SVG может нести скрипт при открытии по прямой
-- ссылке. Лимит 4 МБ — запрос к функции Vercel ограничен 4,5 МБ; крупные фото
-- редактор заранее уменьшает в браузере.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('theory-media', 'theory-media', true, 4194304, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;
