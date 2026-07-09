<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Правила проекта

- **Изображения контента** (задания, книги, галереи) загружаются только лениво: `loading="lazy"` + `decoding="async"`. При пустом `src` или ошибке загрузки вместо картинки выводится заглушка «изображение недоступно» (иконка `ImageOff`), а не сломанный тег. Эталоны: `components/test-player/TaskImage.tsx`, `MarkdownImg` в `components/shared/MarkdownContent.tsx`. Исключение — первая видимая картинка задания и лайтбоксы, открываемые по клику: их грузим сразу (`eager`).
- **Предобработка OCR-книг** (`scripts/book-import.mjs`): вёрстку учебника не воспроизводим дословно — упрощаем до читаемого KaTeX. Строки заданий, завёрнутые OCR в LaTeX-обёртки (`$$\circ\mathbf{12.2.a)}…$$`), распутываются: номер и маркеры подпунктов наружу текстом, формулы — в инлайн `$…$`; короткие display-формулы без переносов конвертируются в инлайн, чтобы не растягивать строку и не порождать горизонтальный скролл. Читаемость важнее пиксельного соответствия книге.
- **Overflow в контенте**: горизонтальный скролл — только у элемента, который реально шире колонки (таблица, display-формула), а не у всего блока/атома.
