# ExamPlatform — Техническая спецификация для Claude Code Agent

> Версия 1.1 · Май 2026  
> Платформа компьютерного тестирования для школьников  
> Деплой: Vercel Free + Supabase Free

---

## 1. Контекст и цель

Необходимо разработать легкую web-платформу для проведения экзаменационного тестирования в школе. Основные акторы — **ученик** и **учитель/администратор**.

### Что должна делать система
- Давать ученику возможность проходить тест в браузере, переключаться между задачами, менять ответы до отправки, видеть результат.
- Давать учителю возможность загружать тесты из PDF, наблюдать за прохождением в реальном времени, управлять доступом к решениям задач.
- Загружаемые PDF бывают трёх видов: **задания** (текст + инструкция + изображения), **ответы** (правильные ответы), **ответы + решения** (ответы и подробный разбор части задач, включая графические пояснения). Система автоматически связывает их по номерам задач.
- **Задания могут содержать изображения** (графики, чертежи, схемы, таблицы, диаграммы, фотографии). Все изображения, относящиеся к задаче, извлекаются из PDF и привязываются к ней. Ученик видит изображения прямо в блоке задачи — над или в тексте задания.

### Архитектурный принцип
Система строится вокруг жизненных циклов, а не CRUD-страниц:

```
PDF → parsing_job → [extract text + images] → review → test_version(published) → assignment → attempt → result
                                                                                        ↓
                                                                             solution_request → grant
```

---

## 2. Стек

| Слой | Технология | Обоснование |
|---|---|---|
| Frontend | Next.js 15, App Router, TypeScript | SSR/ISR, serverless-деплой на Vercel |
| UI | Tailwind CSS + shadcn/ui | Функциональный интерфейс без тяжёлых зависимостей |
| Формы | React Hook Form + Zod | Типизированная валидация форм |
| База данных | Supabase Postgres | Managed Postgres, RLS, хорошие бесплатные лимиты |
| Авторизация | Supabase Auth | Email/password, роли через таблицу profiles |
| Файловое хранилище | Supabase Storage | PDF, извлечённые изображения и артефакты парсинга |
| Realtime | Supabase Realtime | Онлайн-мониторинг активных попыток |
| Background jobs | Supabase Edge Functions | Асинхронный PDF parsing pipeline |
| PDF text parsing | pdf-parse | Извлечение текстового слоя из PDF |
| PDF image extraction | pdfjs-dist (canvas) | Рендер страниц PDF в изображения, вырезка embedded images |
| Image processing | sharp | Оптимизация и конвертация в WebP перед сохранением в Storage |
| AI layer | Vercel AI SDK + Claude API | Структурирование задач из сырого текста |
| Деплой | Vercel Free | Веб-приложение |
| Инфраструктура | Supabase Free | DB, Auth, Storage, Functions, Realtime |

### Ограничения Vercel Free — важно учитывать
- Нельзя держать долгие синхронные функции (лимит 10–60 с в зависимости от плана).
- Всё, что занимает больше 5 секунд, выносить в Edge Function или делать через job queue.
- PDF processing (особенно image extraction) всегда асинхронный — только через Supabase Edge Function.
- Хранить PDF и изображения только в Supabase Storage, не в `/public` Vercel.
- Realtime использовать только для событий, не стримить каждый keystroke ученика.

---

## 3. Роли и доступы

| Роль | Описание |
|---|---|
| `student` | Видит только свои назначения, попытки и результаты |
| `teacher` | Управляет тестами, группами, назначениями, мониторинг, аналитика |
| `admin` | Полный доступ, управление пользователями и организацией |

### Row Level Security (обязательно)
Каждая таблица должна иметь RLS-политики:
- `students` видят только строки, где `user_id = auth.uid()`.
- `teachers` видят данные своей организации / своих групп.
- `admins` видят всё в рамках своей `organization_id`.

Роль хранить в таблице `profiles.role`, брать через `auth.jwt() ->> 'role'` после hook на Supabase Auth.

---

## 4. Полная схема базы данных

### 4.1 Пользователи и организация

```sql
-- Организация / школа
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  settings jsonb default '{}',
  created_at timestamptz default now()
);

-- Профиль пользователя
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references organizations(id),
  full_name text not null,
  role text not null check (role in ('student','teacher','admin')),
  grade text,        -- класс, только для student
  is_active boolean default true,
  created_at timestamptz default now()
);

-- Группы / классы
create table groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) not null,
  name text not null,
  description text,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- Участники группы
create table group_members (
  group_id uuid references groups(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  added_at timestamptz default now(),
  primary key (group_id, user_id)
);
```

### 4.2 Тесты и версии

```sql
-- Тест-контейнер
create table tests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) not null,
  title text not null,
  subject text,
  grade text,
  exam_type text,    -- 'ВПР', 'ОГЭ', 'ЕГЭ', 'Контрольная', etc.
  description text,
  status text not null default 'draft'
    check (status in ('draft','in_review','published','archived')),
  current_published_version_id uuid,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Версия теста (immutable snapshot после публикации)
create table test_versions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid references tests(id) on delete cascade,
  version_number integer not null,
  status text not null default 'draft'
    check (status in ('draft','in_review','published','archived')),
  time_limit_sec integer,
  max_attempts integer default 1,
  shuffle_tasks boolean default false,
  result_visibility text default 'after_submit'
    check (result_visibility in ('instant','after_submit','after_teacher_review','never')),
  scoring_policy jsonb default '{}',
  published_at timestamptz,
  published_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- Загруженные PDF-документы для версии теста
create table test_documents (
  id uuid primary key default gen_random_uuid(),
  test_version_id uuid references test_versions(id) on delete cascade,
  doc_type text not null
    check (doc_type in ('tasks','answers','solutions','mixed')),
  original_filename text,
  storage_path text not null,         -- путь к PDF в Supabase Storage
  page_count integer,
  extracted_text jsonb,               -- [{page: 1, text: "..."}, ...]
  extracted_images_count integer default 0,
  parse_status text default 'pending'
    check (parse_status in ('pending','processing','done','failed')),
  created_at timestamptz default now()
);
```

### 4.3 Задачи теста

```sql
-- Задача в конкретной версии теста
create table test_tasks (
  id uuid primary key default gen_random_uuid(),
  test_version_id uuid references test_versions(id) on delete cascade,
  task_number integer not null,
  title text,
  prompt_text text not null,          -- текст задания (plain text)
  prompt_html text,                   -- HTML-версия с разметкой (с тегами <img> для вставки изображений)
  task_type text not null default 'short_text'
    check (task_type in (
      'single_choice','multiple_choice','short_text',
      'numeric','composite','manual_review'
    )),
  answer_format_hint text,
  answer_parts jsonb default '[]',    -- для composite: [{label, type}, ...]
  options jsonb default '[]',         -- для choice: [{id, text, image_id?}, ...]
  has_images boolean default false,   -- быстрая проверка наличия изображений
  max_score numeric default 1,
  source_doc_id uuid references test_documents(id),
  source_pages integer[],
  parse_confidence numeric,
  review_status text default 'pending'
    check (review_status in ('pending','approved','needs_fix','rejected')),
  review_note text,
  sort_order integer not null,
  created_at timestamptz default now(),
  unique (test_version_id, task_number)
);

-- *** НОВАЯ ТАБЛИЦА: Медиа-ресурсы задачи (изображения) ***
-- Каждое изображение, извлечённое из PDF и привязанное к задаче, — отдельная запись.
create table task_media (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references test_tasks(id) on delete cascade,
  media_type text not null default 'image'
    check (media_type in ('image')),  -- расширяется при необходимости
  storage_path text not null,         -- путь в Supabase Storage: task-media/{task_id}/{filename}.webp
  original_filename text,
  width_px integer,
  height_px integer,
  file_size_bytes integer,
  format text default 'webp',         -- всегда конвертировать в webp через sharp
  -- Позиционирование изображения внутри задачи:
  -- 'above_text' — изображение над текстом задания (по умолчанию)
  -- 'below_text' — изображение под текстом задания
  -- 'inline'     — встроено в HTML prompt_html через <figure>
  placement text default 'above_text'
    check (placement in ('above_text','below_text','inline')),
  sort_order integer default 0,       -- порядок при нескольких изображениях в одной задаче
  alt_text text,                      -- описание для accessibility, заполняется агентом если возможно
  source_page integer,                -- страница PDF, с которой извлечено изображение
  source_bbox jsonb,                  -- {x, y, w, h} в пикселях страницы, для отладки
  is_manually_uploaded boolean default false, -- true если добавлено учителем вручную в Review UI
  created_at timestamptz default now()
);

-- Правильные ответы (скрыты от студентов через RLS)
create table task_answer_keys (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references test_tasks(id) on delete cascade unique,
  correct_answer jsonb not null,
  grading_method text not null default 'exact'
    check (grading_method in (
      'exact','normalized','numeric_tolerance',
      'set_match','contains','regex','manual'
    )),
  grading_config jsonb default '{}',
  partial_score_rules jsonb,
  parse_confidence numeric,
  created_at timestamptz default now()
);

-- Решения задач (скрыты от студентов до явного grant)
-- Решения тоже могут содержать изображения — они хранятся через отдельную таблицу solution_media
create table task_solutions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references test_tasks(id) on delete cascade unique,
  solution_text text,
  solution_html text,                 -- HTML с тегами <figure><img> для изображений решения
  has_images boolean default false,
  access_policy text default 'by_request'
    check (access_policy in ('by_request','after_finish','always_hidden')),
  created_at timestamptz default now()
);

-- *** НОВАЯ ТАБЛИЦА: Медиа-ресурсы решения ***
create table solution_media (
  id uuid primary key default gen_random_uuid(),
  solution_id uuid references task_solutions(id) on delete cascade,
  media_type text not null default 'image'
    check (media_type in ('image')),
  storage_path text not null,         -- solution-media/{solution_id}/{filename}.webp
  original_filename text,
  width_px integer,
  height_px integer,
  file_size_bytes integer,
  format text default 'webp',
  sort_order integer default 0,
  alt_text text,
  source_page integer,
  created_at timestamptz default now()
);
```

### 4.4 Назначения

```sql
create table assignments (
  id uuid primary key default gen_random_uuid(),
  test_version_id uuid references test_versions(id) not null,
  organization_id uuid references organizations(id) not null,
  group_id uuid references groups(id),
  student_id uuid references profiles(id),
  starts_at timestamptz,
  ends_at timestamptz,
  max_attempts integer default 1,
  time_limit_override_sec integer,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  check (group_id is not null or student_id is not null)
);
```

### 4.5 Попытки и ответы

```sql
create table attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid references assignments(id) not null,
  student_id uuid references profiles(id) not null,
  status text not null default 'not_started'
    check (status in (
      'not_started','in_progress','submitted',
      'under_review','checked','expired'
    )),
  started_at timestamptz,
  submitted_at timestamptz,
  checked_at timestamptz,
  last_activity_at timestamptz,
  current_task_number integer default 1,
  score numeric,
  max_score numeric,
  teacher_comment text,
  created_at timestamptz default now()
);

create table attempt_task_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references attempts(id) on delete cascade,
  task_id uuid references test_tasks(id),
  answer_json jsonb,
  normalized_answer_json jsonb,
  is_correct boolean,
  awarded_score numeric,
  auto_checked_at timestamptz,
  teacher_comment text,
  teacher_checked_at timestamptz,
  answer_version integer default 1,
  updated_at timestamptz default now(),
  unique (attempt_id, task_id)
);
```

### 4.6 Доступ к решениям

```sql
create table solution_requests (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references attempts(id) not null,
  task_id uuid references test_tasks(id) not null,
  student_id uuid references profiles(id) not null,
  student_message text,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  teacher_note text,
  expires_at timestamptz,
  created_at timestamptz default now(),
  unique (attempt_id, task_id)
);
```

### 4.7 Сервисные таблицы

```sql
create table parsing_jobs (
  id uuid primary key default gen_random_uuid(),
  test_version_id uuid references test_versions(id) not null,
  status text not null default 'queued'
    check (status in ('queued','processing','needs_review','done','failed')),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  -- Расширенная сводка с учётом изображений:
  result_summary jsonb,
  -- Пример result_summary:
  -- {
  --   "tasks_found": 10,
  --   "answers_matched": 10,
  --   "solutions_matched": 4,
  --   "images_extracted": 7,
  --   "images_attached": 7,
  --   "warnings_count": 2
  -- }
  created_at timestamptz default now()
);

create table parsing_warnings (
  id uuid primary key default gen_random_uuid(),
  parsing_job_id uuid references parsing_jobs(id) on delete cascade,
  task_id uuid references test_tasks(id),
  warning_type text not null,
  -- Типы предупреждений включают image-специфичные:
  -- 'low_confidence','no_answer','ambiguous_numbering',
  -- 'image_extraction_failed','image_no_task_match',
  -- 'image_quality_low','orphan_answer','orphan_solution'
  description text,
  source_text_snippet text,
  source_page integer,
  is_resolved boolean default false,
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  created_at timestamptz default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id),
  actor_id uuid references profiles(id),
  action text not null,
  entity_type text,
  entity_id uuid,
  meta jsonb default '{}',
  created_at timestamptz default now()
);

create table presence_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references attempts(id) on delete cascade,
  student_id uuid references profiles(id),
  event_type text not null,
  current_task_number integer,
  meta jsonb default '{}',
  created_at timestamptz default now()
);
```

---

## 5. Пайплайн парсинга PDF

### 5.1 Стадии

```
UPLOAD → EXTRACT_TEXT → EXTRACT_IMAGES → CLASSIFY → SEGMENT → AGENT_PARSE → MATCH → REVIEW → PUBLISH
```

#### UPLOAD
Преподаватель загружает от одного до трёх PDF в рамках одного пакета:
- `tasks` — задания и инструкция (основной источник изображений).
- `answers` — только правильные ответы (обычно без изображений).
- `solutions` — ответы с разбором, могут содержать графические решения.

Файлы сохраняются в Supabase Storage: `test-documents/{test_version_id}/{doc_type}/original.pdf`.  
Создаётся `parsing_job` со статусом `queued`.

#### EXTRACT_TEXT
Edge Function извлекает текст постранично через `pdf-parse`.  
Сохраняет в `test_documents.extracted_text` как `[{page: 1, text: "..."}, ...]`.

#### EXTRACT_IMAGES ⭐ (новый, обязательный этап)

**Это критически важный этап.** Большинство школьных заданий содержат изображения: графики, таблицы, чертежи, схемы, молекулярные формулы.

**Стратегия A — Embedded image extraction (приоритетная)**  
Использовать `pdfjs-dist` для обхода объектов страницы и извлечения embedded image ресурсов (XObject Image). Каждый найденный image-объект сохраняется в raw buffer.

```typescript
// Псевдокод для агента
const pdfDoc = await pdfjsLib.getDocument(pdfBuffer).promise;
for (const pageNum of pages) {
  const page = await pdfDoc.getPage(pageNum);
  const ops = await page.getOperatorList();
  // Найти paintImageXObject операции, извлечь по имени из page.commonObjs / page.objs
  const images = extractImagesFromOperatorList(ops, page);
  // Для каждого image: получить ImageData, конвертировать через sharp в WebP
}
```

**Стратегия B — Page render fallback (если embedded не найдено)**  
Если страница содержит сканированные изображения или векторные рисунки, которые не детектируются как XObject:
1. Рендерить страницу в Canvas через `pdfjs-dist` (разрешение 150 dpi достаточно).
2. Сохранить весь рендер страницы как изображение.
3. Пометить как `page_render`, чтобы агент/учитель мог решить, к какой задаче оно относится.

**Хранение извлечённых изображений**  
Путь в Storage: `task-media/raw/{test_version_id}/page_{N}_img_{M}.webp`  
После привязки к задаче путь переименовывается: `task-media/{task_id}/{uuid}.webp`

**Обработка через sharp (обязательно)**  
- Конвертировать все изображения в WebP.
- Ограничить максимальный размер: 1200 px по длинной стороне (школьные задания не требуют больше).
- Убрать EXIF.
- Сохранять оригинальный aspect ratio.

**Image-to-task matching**  
Самый сложный шаг — понять, к какой задаче относится изображение. Стратегии в порядке приоритета:

1. **По пространственной близости**: если изображение находится на той же странице и сразу после текста задачи N, и до начала задачи N+1 → привязать к задаче N.
2. **По bbox**: если `source_bbox.y` изображения входит в диапазон y-координат текстового блока задачи → привязать к ней.
3. **По явной ссылке**: если в тексте задачи есть "на рисунке", "см. рисунок", "по графику" → помечать задачу как `has_images=true`, отправлять на ручную привязку.
4. **Fallback**: изображение не привязано автоматически → статус `unmatched`, уходит в очередь ручной привязки в Review UI.

#### CLASSIFY
По ключевым словам и структуре текста определяется тип документа:
- Нет нумерации задач или нет ответов → `tasks`.
- Только короткие ответы по номерам → `answers`.
- Развёрнутые блоки с выкладками → `solutions`.
- Смесь → `mixed`.

#### SEGMENT
Поиск границ задач по паттернам: `1.`, `2.`, `Задание 1`, `Задача 3`, нумерованные заголовки.  
Построение candidate-блоков: `{number, text, source_pages, image_ids[], confidence}`.  
Вложенные подпункты (`1)`, `2)`) разбираются как части одной задачи типа `composite`.

#### AGENT_PARSE
Внутренний агент получает сегментированный текст + метаданные изображений и возвращает нормализованный JSON:

```typescript
interface ParsedTest {
  meta: {
    title?: string;
    subject?: string;
    exam_type?: string;
    grade?: string;
  };
  tasks: Array<{
    number: number;
    prompt_text: string;
    prompt_html?: string;              // HTML с <figure> тегами для изображений
    task_type_guess: TaskType;
    options?: Array<{
      id: string;
      text: string;
      image_ref?: string;             // ссылка на image id если вариант содержит картинку
    }>;
    answer_parts?: Array<{label: string; type: string}>;
    answer_format_hint?: string;
    image_refs: string[];             // id извлечённых изображений, относящихся к задаче
    images_placement: 'above_text' | 'below_text' | 'inline';
    has_unmatched_images: boolean;    // если в тексте есть ссылки на картинки, но они не найдены
    source_pages: number[];
    confidence: number;
  }>;
  answers: Array<{
    task_number: number;
    correct_answer: string | string[] | Record<string, string>;
    grading_method_guess: GradingMethod;
    confidence: number;
  }>;
  solutions: Array<{
    task_number: number;
    solution_text: string;
    solution_html?: string;           // HTML с изображениями для решения
    image_refs: string[];
    confidence: number;
  }>;
  unmatched_images: Array<{          // изображения, которые не удалось привязать к задаче
    image_id: string;
    source_page: number;
    suggested_task_number?: number;
    reason: string;
  }>;
  warnings: Array<{
    type: string;
    description: string;
    task_number?: number;
    source_page?: number;
  }>;
}
```

Агенту передаётся системный промпт с:
- описанием формата выходного JSON,
- примерами нумерации задач,
- правилами разграничения задачи / подзадачи,
- инструкцией помечать задачи с текстовыми ссылками на изображения (`"по графику"`, `"на рисунке"`) даже если изображение не найдено,
- инструкцией не домысливать ответы при низкой уверенности.

#### MATCH
Связывание по номеру задачи:
- Ответы → задачи.
- Решения → задачи.
- Изображения → задачи (по `image_refs` из AGENT_PARSE).
- Несвязанные объекты → warnings (`orphan_answer`, `orphan_solution`, `image_no_task_match`).

После MATCH:
- Создаются записи в `task_media` для каждого привязанного изображения.
- Поле `test_tasks.has_images` устанавливается в `true` для задач с изображениями.
- `test_documents.extracted_images_count` обновляется.

#### REVIEW
Преподаватель видит Review UI:
- Таблица задач с их текстами, изображениями (thumbnails), типами, ответами и confidence.
- Задачи с `confidence < 0.7` или `has_unmatched_images = true` — выделены и обязательны для проверки.
- Для каждой задачи:
  - Кнопки: "Подтвердить", "Редактировать", "Удалить".
  - **Блок изображений**: thumbnails прикреплённых изображений с возможностью:
    - Удалить изображение от задачи.
    - Изменить placement (`above_text` / `below_text` / `inline`).
    - Изменить порядок изображений (drag & drop).
    - Добавить изображение вручную (upload).
    - Перенести изображение к другой задаче.
  - **Unmatched images panel**: отдельная секция со всеми нераспознанными изображениями — учитель перетаскивает их к нужным задачам.
- Публикация не разрешена, пока есть задачи со статусом `needs_fix` или `pending`, или есть unmatched images с флагом "обязательно привязать".

#### PUBLISH
После одобрения всех задач:
1. Все задачи, ответы, изображения фиксируются в таблицах.
2. Пути к изображениям переименовываются из `raw/` в `task-media/{task_id}/`.
3. Статус версии → `published` (immutable).
4. Audit log: `test.publish`.

---

## 6. Логика сверки ответов

Реализовать как отдельный модуль `lib/grading/checker.ts`.

### Методы проверки

| Метод | Когда использовать | Конфигурация |
|---|---|---|
| `exact` | Текстовый ответ с точным совпадением | `case_sensitive: boolean` |
| `normalized` | Ответ с нормализацией пробелов и регистра | — |
| `numeric_tolerance` | Числовой ответ с погрешностью | `tolerance: number` |
| `set_match` | Несколько ответов без учёта порядка | `partial_credit: boolean` |
| `contains` | Ответ содержит ключевые слова | `keywords: string[]` |
| `regex` | Нестандартный формат | `pattern: string` |
| `manual` | Открытый вопрос, ручная проверка | — |

### Нормализация перед сравнением (всегда)
1. Trim пробелов.
2. Замена `,` на `.` в десятичных числах.
3. Удаление лишних пробелов внутри строки.
4. Нижний регистр (если не `case_sensitive`).
5. Нормализация числового формата (убрать разделители тысяч).

### Подсчёт баллов
- Каждая задача имеет `max_score`.
- Полный балл — при полностью правильном ответе.
- Частичный балл — при `partial_score_rules` для `set_match` и `composite`.
- Итоговый балл — сумма `awarded_score` по всем задачам.

---

## 7. Realtime мониторинг

### Что слать в realtime
- `attempt.status_change` — смена статуса попытки.
- `presence.heartbeat` — раз в 30 секунд, с `current_task_number` и `last_activity_at`.
- `solution_request.created` — новый запрос на решение.

### Автосохранение ответов
- Debounced сохранение через 3–5 секунд после последнего изменения.
- При переходе на другую задачу — немедленное сохранение.
- Статус "Сохранено" / "Сохранение..." / "Ошибка" в шапке.
- При восстановлении связи — автосинхронизация очереди сохранений.

### Экран мониторинга (учитель)
Таблица: Ученик · Группа · Тест · Статус (чип) · Текущая задача · Прогресс (bar) · Last activity · Балл.  
Клик → drawer с деталями попытки и ответами.

---

## 8. Workflow доступа к решениям

### Со стороны ученика
1. Кнопка "Запросить разбор задачи" на экране задачи.
2. Открывается модальное окно: поле "Что непонятно?" (опционально).
3. Запрос отправляется только для задач с `task_solutions`.
4. После одобрения — ученик видит блок решения **с изображениями** (если они есть).
5. Изображения решения загружаются через signed URL (server-side).

### Со стороны учителя
1. Badge в меню с количеством pending запросов.
2. Страница "Запросы на решения": ученик, задача, тест, сообщение, время.
3. Кнопки "Одобрить" и "Отклонить" с опциональным комментарием.
4. Одобрение создаёт `solution_requests.status = 'approved'` и обновляет `expires_at`.

---

## 9. Структура проекта

```
exam-platform/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── student/
│   │   ├── layout.tsx
│   │   ├── page.tsx                      # список назначенных тестов
│   │   ├── attempt/[id]/
│   │   │   ├── page.tsx                  # test player
│   │   │   └── result/page.tsx
│   │   └── history/page.tsx
│   ├── teacher/
│   │   ├── layout.tsx
│   │   ├── page.tsx                      # dashboard
│   │   ├── monitor/page.tsx
│   │   ├── tests/
│   │   │   ├── page.tsx
│   │   │   ├── new/page.tsx
│   │   │   └── [id]/
│   │   │       ├── page.tsx
│   │   │       ├── import/page.tsx
│   │   │       ├── review/page.tsx       # includes image review
│   │   │       ├── preview/page.tsx
│   │   │       └── analytics/page.tsx
│   │   ├── assignments/
│   │   ├── results/
│   │   ├── solution-requests/page.tsx
│   │   ├── groups/
│   │   └── students/
│   └── api/
│       ├── auth/[...supabase]/route.ts
│       ├── parsing/trigger/route.ts
│       ├── media/signed-url/route.ts     # *** НОВЫЙ: выдача signed URL для изображений
│       ├── attempts/[id]/
│       │   ├── answers/route.ts
│       │   └── submit/route.ts
│       ├── solution-requests/route.ts
│       └── export/results/route.ts
├── components/
│   ├── ui/
│   ├── test-player/
│   │   ├── TaskNavigator.tsx
│   │   ├── TaskView.tsx                  # рендерит текст + TaskImageGallery
│   │   ├── TaskImageGallery.tsx          # *** НОВЫЙ: отображение изображений задачи
│   │   ├── TaskImage.tsx                 # *** НОВЫЙ: одно изображение с lazy-load + lightbox
│   │   ├── SolutionView.tsx              # *** НОВЫЙ: блок решения с изображениями
│   │   ├── AnswerInput/
│   │   │   ├── SingleChoice.tsx
│   │   │   ├── MultipleChoice.tsx
│   │   │   ├── ShortText.tsx
│   │   │   ├── Numeric.tsx
│   │   │   └── Composite.tsx
│   │   ├── SaveStatus.tsx
│   │   ├── Timer.tsx
│   │   └── SubmitDialog.tsx
│   ├── teacher/
│   │   ├── AttemptMonitorTable.tsx
│   │   ├── AttemptDrawer.tsx
│   │   ├── PdfUploader.tsx
│   │   ├── ParseReviewTable.tsx
│   │   ├── TaskEditor.tsx                # includes image management
│   │   ├── TaskImageEditor.tsx           # *** НОВЫЙ: привязка/отвязка/переупорядочивание изображений
│   │   ├── UnmatchedImagesPanel.tsx      # *** НОВЫЙ: нераспознанные изображения → drag to task
│   │   ├── SolutionRequestList.tsx
│   │   └── AnalyticsCharts.tsx
│   └── shared/
│       ├── RoleGuard.tsx
│       ├── AuditLog.tsx
│       └── ExportButton.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   ├── server.ts
│   │   └── admin.ts
│   ├── grading/
│   │   ├── checker.ts
│   │   └── normalizer.ts
│   ├── parsing/
│   │   ├── extractor.ts                  # pdf → raw text pages
│   │   ├── image-extractor.ts            # *** НОВЫЙ: pdf → extracted images (pdfjs-dist)
│   │   ├── image-processor.ts            # *** НОВЫЙ: sharp: resize, webp, optimize
│   │   ├── image-matcher.ts              # *** НОВЫЙ: image → task matching logic
│   │   ├── classifier.ts
│   │   ├── segmenter.ts
│   │   └── agent.ts
│   ├── media/
│   │   └── signed-urls.ts                # *** НОВЫЙ: генерация signed URL для изображений
│   ├── permissions/
│   │   └── can.ts
│   └── analytics/
│       └── queries.ts
├── supabase/
│   ├── migrations/
│   ├── functions/
│   │   └── process-pdf/                  # Edge Function (text + image extraction)
│   └── seed.sql
├── types/
│   ├── database.ts
│   └── domain.ts
├── middleware.ts
├── next.config.ts
├── tailwind.config.ts
└── supabase/config.toml
```

---

## 10. Экраны и UX

### 10.1 Test Player (ученик)

**Шапка (sticky top)**
- Название теста, таймер, статус сохранения, кнопка "Завершить".

**Боковая панель / сетка номеров**
- Цветовые статусы задач (не отвечена / отвечена / помечена / ошибка).
- Счётчик "Отвечено: X / Y".

**Основная область — блок задачи**

Структура блока задачи строго следует этой иерархии:

```
┌─────────────────────────────────────────────┐
│  Задача № N                          [flag]  │
├─────────────────────────────────────────────┤
│  [ИЗОБРАЖЕНИЯ — placement: above_text]       │
│  ┌──────────┐  ┌──────────┐                 │
│  │  img 1   │  │  img 2   │  (если > 1)     │
│  └──────────┘  └──────────┘                 │
├─────────────────────────────────────────────┤
│  Текст задания...                            │
│  (если placement: inline — img внутри текста)│
├─────────────────────────────────────────────┤
│  [ИЗОБРАЖЕНИЯ — placement: below_text]       │
├─────────────────────────────────────────────┤
│  Подсказка формата ответа                    │
├─────────────────────────────────────────────┤
│  [ ПОЛЕ ВВОДА ОТВЕТА ]                       │
└─────────────────────────────────────────────┘
```

**Правила отображения изображений задачи:**
- Все изображения загружаются через API route `/api/media/signed-url?path=...`, который генерирует `createSignedUrl` server-side с TTL 1 час. Никогда не выдавать прямой Storage URL.
- Изображения загружаются с `loading="lazy"` и отображаются с сохранением пропорций.
- При наличии нескольких изображений — галерея из thumbnails 280 px wide, при клике открывается lightbox на весь экран.
- На мобиле изображения всегда full-width с горизонтальным scroll если их несколько.
- Под каждым изображением отображается `alt_text` (если задан) мелким шрифтом — для accessibility.
- Если изображение не загрузилось — fallback placeholder с иконкой и текстом "Изображение недоступно".

**Поле ввода**  
Тип поля по типу задачи (single_choice, multiple_choice, short_text, numeric, composite).

**Кнопки навигации**  
← Назад / Далее → + кнопка "Запросить разбор" (только после завершения попытки, только если у задачи есть решение).

**Блок решения (после одобрения запроса)**
- Текст решения (solution_html с изображениями).
- Изображения решения отображаются так же через signed URL.
- Полная visual-структура: текст + иллюстрации к шагам решения.

**Итоговый экран**
- Балл, список задач с результатами, кнопки "Запросить разбор" для задач с решениями.

### 10.2 Мониторинг (учитель)

Realtime-таблица: ученик, группа, тест, статус, текущая задача, прогресс, last activity, балл.  
Клик → Drawer с деталями, включая текущую задачу с превью изображений.

### 10.3 Import + Review (учитель)

**Шаг 1 — Upload**
- Drag & drop зоны для трёх типов PDF.
- Progress bar загрузки каждого файла.
- Кнопка "Запустить парсинг".

**Шаг 2 — Processing**
- Прогресс в реальном времени: "Извлечение текста... Извлечение изображений... Структурирование задач..."
- Итоговая сводка: "Задач: X · Ответов: Y · Изображений: Z · Предупреждений: W"

**Шаг 3 — Review**

Основная таблица задач:
- Номер · Текст задания · **Миниатюры изображений** · Тип · Правильный ответ · Confidence
- Строки с `confidence < 0.7` или `has_unmatched_images = true` — выделены
- Inline-редактирование текста задачи, типа, ответа

Для каждой задачи в развёрнутом виде — **Image Manager**:
- Список прикреплённых изображений в виде thumbnails.
- Drag & drop для изменения порядка.
- Кнопка изменить `placement` (выпадающий список: "над текстом" / "под текстом" / "в тексте").
- Кнопка "Удалить" (изображение переходит в unmatched).
- Кнопка "Добавить изображение" (ручная загрузка файла или вырезка из рендера страницы).
- Поле `alt_text` для каждого изображения.

**Unmatched Images Panel** (появляется если есть нераспознанные изображения):
- Секция в нижней части страницы или боковой панели.
- Показывает все изображения, которые не были автоматически привязаны к задачам.
- Каждое изображение показывает: миниатюру, номер страницы PDF, предложенную задачу агента (если есть).
- Drag & drop изображения на задачу в основной таблице.
- Кнопка "Удалить" (исключить из теста).

Кнопка "Опубликовать" активна только когда:
- Нет задач в статусе `pending` / `needs_fix`.
- Нет unmatched изображений (или они все удалены/привязаны).

---

## 11. Аналитика

### По ученику
- Средний балл, лучший результат, история попыток, ошибки по темам.

### По тесту
- Средний балл, медиана, процент завершивших.
- Самые сложные задачи (по проценту ошибок).
- Среднее время на тест и на задачу.
- Процент запросов решения по каждой задаче.

### По задаче
- Процент правильных ответов.
- Топ неправильных ответов.
- Среднее время ответа.
- Количество изменений ответа перед отправкой.

### Экспорт
CSV: ученик, группа, попытка, балл, баллы по каждой задаче, дата.

---

## 12. Нефункциональные требования

### Производительность
- Test player загружается за < 2 с (без изображений, они lazy).
- Изображения задачи — lazy-load с LQIP или skeleton placeholder.
- Изображения задач — WebP, max 1200 px по длинной стороне, < 200 KB каждое после оптимизации.
- Parsing job (text + images) — асинхронный, не блокирует UI.

### Безопасность
- RLS на всех таблицах, включая `task_media` и `solution_media`.
- **Изображения задач доступны всем ученикам** с назначением на этот тест (через signed URL).
- **Изображения решений** — только через проверку `solution_requests.status = 'approved'` server-side.
- Никогда не выдавать прямой Storage URL — только через `/api/media/signed-url` с авторизацией.
- Правильные ответы и решения — только server-side.

### Хранилище изображений
- Bucket `task-media` — public-accessible через signed URL, RLS политика на уровне приложения.
- Bucket `solution-media` — private, только через server-side signed URL.
- Bucket `test-documents` — private, только для admins/teachers.
- Лимиты Supabase Free: 1 GB storage, 2 GB bandwidth/месяц — учитывать при расчёте размера тестов.

### Адаптивность
- От 375 px (мобиль) до 2560 px (десктоп).
- На мобиле изображения full-width с lightbox по нажатию.
- На планшете — 2-колонная галерея изображений.

### Ограничения Vercel Free
- PDF text extraction + image extraction — только через Supabase Edge Function (async).
- `sharp` запускается только в Edge Function, не в Next.js route handler.
- Signed URL генерация — быстрая операция, допускается в route handler.

---

## 13. Порядок реализации (milestones)

### Milestone 1 — Auth + Base
- Supabase проект, полная схема БД (все миграции, включая `task_media`, `solution_media`).
- Supabase Auth, роли через profiles.
- Middleware для роутинга по ролям.
- Базовые layouts.

### Milestone 2 — Test Player (без изображений)
- Список назначенных тестов.
- Test player с навигацией и всеми типами ввода.
- Автосохранение ответов.
- Финальная отправка и автопроверка.
- Итоговый экран.

### Milestone 3 — Изображения в Test Player ⭐
- API route `/api/media/signed-url` для генерации signed URL.
- `TaskImageGallery` и `TaskImage` компоненты.
- Lightbox для полноэкранного просмотра.
- Отображение изображений решения в `SolutionView`.
- Корректная работа на мобиле и планшете.

### Milestone 4 — Teacher Dashboard
- Dashboard, мониторинг, просмотр попыток.
- Realtime heartbeat.
- Группы и назначения.

### Milestone 5 — PDF Import Pipeline
- Edge Function: text extraction + image extraction + sharp обработка.
- Классификация, сегментация, agent parse.
- Image-to-task matching.
- Сохранение `task_media` записей.
- Review UI с Image Manager и Unmatched Images Panel.
- Публикация версии.

### Milestone 6 — Solution Requests
- Запрос решения учеником.
- Очередь в кабинете учителя.
- Одобрение с выдачей доступа к solution + solution_media.

### Milestone 7 — Analytics + Export
- Аналитика по ученику и тесту.
- Экспорт CSV.

### Milestone 8 — Polish
- Skeleton loaders для изображений.
- Fallback при ошибке загрузки изображения.
- Состояния empty, error, loading везде.
- Оптимизация мобильного test player.
- Проверка RLS политик.
- Audit log viewer.

---

## 14. Acceptance Criteria

- [ ] Учитель загружает пакет PDF (задания с изображениями + ответы + решения), видит извлечённые изображения, привязывает нераспознанные, публикует тест.
- [ ] В Review UI у каждой задачи видны прикреплённые изображения, можно изменить порядок, placement и alt-текст.
- [ ] Нераспознанные изображения отображаются отдельно и могут быть привязаны к задачам вручную.
- [ ] Ученик видит изображения задачи над текстом (или inline) в блоке задачи test player.
- [ ] Изображения задач загружаются через signed URL, прямой Storage URL не выдаётся.
- [ ] Изображения решения недоступны без одобрения запроса учителем.
- [ ] На мобиле (375 px) изображения отображаются full-width и открываются в lightbox.
- [ ] Ученик проходит тест, возвращается к ранее отвеченным задачам, меняет ответы, отправляет.
- [ ] Учитель в реальном времени видит прогресс учеников.
- [ ] Сервис деплоится на Vercel + Supabase без дополнительной инфраструктуры.

---

## 15. Замечания агенту

1. **Сначала — схема БД.** Все миграции писать до первой строки TypeScript. Включить `task_media` и `solution_media` сразу.
2. **RLS с самого начала.** Особенно важно для `task_media` (видно ученикам) и `solution_media` (только через grant).
3. **Signed URLs — только server-side.** Создать один API route `/api/media/signed-url` с авторизацией. Все компоненты запрашивают URL через него, не напрямую к Storage.
4. **Image extraction в Edge Function.** `pdfjs-dist` с Canvas и `sharp` требуют Node.js окружение — запускать только в Supabase Edge Function, не в Next.js route handler.
5. **Image matching — с fallback на ручную привязку.** Не блокировать публикацию из-за нераспознанных изображений — дать учителю инструменты для ручной привязки.
6. **WebP + size limits.** Все изображения конвертировать в WebP, ограничить 1200 px и 200 KB. Supabase Free Storage ограничен — экономить место.
7. **Lazy loading везде.** Изображения задач не должны блокировать загрузку test player. Использовать `loading="lazy"` + skeleton placeholder.
8. **Lightbox без тяжёлых библиотек.** Реализовать простой lightbox на CSS + Portal без громоздких зависимостей (достаточно dialog + CSS transform).
9. **Versioning тестов — immutable.** Published version нельзя изменять. Это касается и `task_media` — после публикации изображения не удаляются.
10. **Parsing pipeline — только async.** Никогда не запускать image extraction в HTTP request-response.
11. **Grading модуль — изолированный.** `lib/grading/checker.ts` — покрыть unit-тестами.
12. **Type safety.** `types/database.ts` генерировать через `supabase gen types`.
13. **alt_text для изображений.** Агент должен пытаться определить описание изображения по контексту задачи — это улучшает accessibility и помогает при ошибках загрузки.

