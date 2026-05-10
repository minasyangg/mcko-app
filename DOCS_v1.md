# ExamPlatform — Документация v1

> Next.js · Supabase · TypeScript · Tailwind CSS · Vercel

---

## Содержание

1. [Обзор системы](#1-обзор-системы)
2. [Архитектура](#2-архитектура)
3. [База данных](#3-база-данных)
4. [Роли и доступ](#4-роли-и-доступ)
5. [Модули учителя](#5-модули-учителя)
6. [Модули студента](#6-модули-студента)
7. [Пайплайн обработки тестов](#7-пайплайн-обработки-тестов)
8. [Система оценивания](#8-система-оценивания)
9. [API Reference](#9-api-reference)
10. [Безопасность](#10-безопасность)
11. [Деплой](#11-деплой)
12. [Переменные окружения](#12-переменные-окружения)

---

## 1. Обзор системы

ExamPlatform — платформа для проведения школьных тестов (ВПР, ОГЭ, ЕГЭ, КР). Учитель загружает тест из PDF/MD/JSON, платформа парсит задания, назначает ученикам. Ученики проходят тест, учитель проверяет ответы. Поддерживаются накопительные попытки — правильно засчитанные задания блокируются и переносятся в следующую попытку.

### Технологический стек

| Слой | Технология |
|------|-----------|
| Frontend | Next.js 15 (App Router), React 19, TypeScript |
| UI | Tailwind CSS, shadcn/ui, Lucide icons |
| Backend | Next.js API Routes (Edge/Node runtime) |
| База данных | Supabase (PostgreSQL 15) |
| Аутентификация | Supabase Auth |
| Хранилище файлов | Supabase Storage |
| AI/парсинг | DeepSeek API (deepseek-chat) |
| Формулы | KaTeX (remark-math + rehype-katex) |
| Рендеринг HTML | rehype-raw + rehype-sanitize |
| Изображения | sharp (WebP конвертация и кроп) |
| Деплой | Vercel |

---

## 2. Архитектура

```
mcko-app/
├── app/
│   ├── api/                    # API Routes
│   │   ├── admin/students/     # CRUD учеников
│   │   ├── assignments/        # Управление назначениями
│   │   ├── attempts/           # Попытки: ответы, сабмит, проверка
│   │   ├── parsing/trigger/    # Запуск парсинга PDF/MD/JSON
│   │   ├── scoring-rules/      # Правила оценивания
│   │   ├── solution-requests/  # Запросы решений
│   │   └── tests/              # Тесты и версии
│   ├── student/                # Кабинет студента
│   └── teacher/                # Кабинет учителя
├── components/
│   ├── shared/                 # MarkdownContent, MathText, ImageGallery
│   ├── teacher/                # AttemptDrawer, MonitorTable, ReviewBoard, ...
│   └── test-player/            # TestPlayer, TaskView, AnswerInput/...
├── lib/
│   ├── analytics/queries.ts    # Аналитические запросы
│   ├── grading/checker.ts      # Автоматическая проверка ответов
│   └── supabase/               # Клиенты: server, client, admin
├── supabase/migrations/        # SQL миграции (001–008)
└── types/
    ├── database.ts             # Сгенерированные типы Supabase
    └── domain.ts               # Доменные типы
```

### Схема запроса

```
Browser → Next.js App Router
         ├── Server Component  → Supabase (server client, RLS активен)
         └── API Route
              ├── createClient()       # User client, RLS активен
              └── createAdminClient()  # Service role, RLS обходится
                                       # (только после auth+authz проверки)
```

---

## 3. База данных

### Таблицы

| Таблица | Назначение | RLS |
|---------|-----------|-----|
| `organizations` | Организации (школы) | ✅ |
| `profiles` | Профили пользователей (teacher/student/admin) | ✅ |
| `groups` | Группы студентов | ✅ |
| `group_members` | Членство студентов в группах | ✅ |
| `tests` | Тесты (метаданные: название, предмет, класс, тип) | ✅ |
| `test_versions` | Версии теста (draft → in_review → published) | ✅ |
| `test_documents` | Загруженные PDF/MD/JSON файлы | ✅ |
| `test_tasks` | Задания теста (prompt, тип, max_score) | ✅ |
| `task_answer_keys` | Правильные ответы (видны только учителю) | ✅ |
| `task_solutions` | Тексты решений (by_request) | ✅ |
| `task_media` | Изображения к заданиям (WebP) | ✅ |
| `solution_media` | Изображения к решениям | ✅ |
| `assignments` | Назначения теста студенту/группе | ✅ |
| `attempts` | Попытки студента | ✅ |
| `attempt_task_answers` | Ответы студента на каждое задание | ✅ |
| `student_final_results` | Накопительный итог по всем попыткам | ✅ |
| `scoring_rules` | Шаблоны максимальных баллов | ✅ |
| `scoring_rule_items` | Баллы по номерам заданий | ✅ |
| `solution_requests` | Запросы студента на просмотр решения | ✅ |
| `parsing_jobs` | Задания на парсинг (queued/processing/done/failed) | ✅ |
| `parsing_warnings` | Предупреждения парсера | ✅ |
| `presence_events` | События присутствия студента в тесте | ✅ |
| `audit_logs` | Лог действий | ✅ |

### Ключевые связи

```
organizations
  └── profiles (role: teacher/student/admin)
  └── groups → group_members → profiles
  └── tests → test_versions → test_tasks
                                └── task_answer_keys
                                └── task_solutions → solution_media
                                └── task_media
              └── assignments → attempts → attempt_task_answers
                                        → presence_events
                             → student_final_results
  └── scoring_rules → scoring_rule_items
```

### Миграции

| Файл | Содержание |
|------|-----------|
| `001_initial.sql` | Базовые таблицы, RLS политики |
| `002_attempts.sql` | Таблицы попыток и ответов |
| `003_storage.sql` | Бакеты Supabase Storage (task-media, test-documents) |
| `004_*.sql` | Расширения (solution_requests, presence_events) |
| `005_student_deletion.sql` | Функция `delete_student_cascade()`, мягкое удаление |
| `006_md_and_features.sql` | MD-парсер, KaTeX поддержка |
| `007_answer_locking.sql` | Поля `is_locked`, `locked_in_attempt_id` |
| `008_scoring_rules.sql` | Таблицы `scoring_rules`, `scoring_rule_items` |

---

## 4. Роли и доступ

| Роль | Права |
|------|-------|
| `student` | Просматривать свои назначения, проходить тесты, видеть свои результаты |
| `teacher` | Всё выше + создавать тесты, назначать, проверять, управлять учениками/группами |
| `admin` | Все права teacher |

Все API routes проверяют:
1. `supabase.auth.getUser()` → 401 если нет сессии
2. `profiles.role` → 403 если недостаточно прав
3. `organization_id` матч → 404 если чужие данные

---

## 5. Модули учителя

### 5.1 Тесты (`/teacher/tests`)

**Создание теста** (`/teacher/tests/new`):
- Поля: название, предмет (select: Математика/Физика/ТВИС/Русский язык), класс, тип (ВПР/ОГЭ/ЕГЭ/Контрольная/Другое), описание
- Создаёт `tests` + `test_versions` (version_number=1, status=draft)
- Перенаправляет на страницу загрузки документа

**Импорт** (`/teacher/tests/[id]/import`):
- Поддерживаемые форматы: PDF, Markdown (`.md`), PaddleOCR JSON (`.json`)
- Загружает в бакет `test-documents`, запускает парсинг через `/api/parsing/trigger`
- Статус парсинга опрашивается каждые 3 сек

**Проверка** (`/teacher/tests/[id]/review`):
- Просмотр распознанных заданий, редактирование текста, управление изображениями
- Кнопка "Одобрить все" → устанавливает `review_status=approved` + применяет правила оценивания
- Публикация → `test_versions.status=published`, `tests.status=published`

### 5.2 Назначения (`/teacher/assignments`)

- Создание: выбор теста (только опубликованные, активные), студента или группы, дат, числа попыток
- Таблица: ФИО/группа, тест, статус (Активно/Истекло/Завершён N/M попыток)
- Удаление назначения каскадно удаляет связанные попытки

### 5.3 Мониторинг (`/teacher/monitor`)

- Real-time просмотр активных попыток (подписка на Supabase Realtime)
- Одна строка на назначение (не на попытку): показывает номер текущей попытки
- Статусы: В процессе / Ожидает проверки · попытка N / Тест завершён

### 5.4 Результаты (`/teacher/results`)

- Таблица с фильтрами (по тесту, группе, статусу)
- Статусы: "На проверке" (submitted) / "Завершён" (checked)
- Клик по строке → `AttemptDrawer` с детальной проверкой
- Ввод баллов за каждое задание; `is_locked=true` → поле заблокировано (засчитано в предыдущей попытке)
- После финализации проверки балл обновляется в строке без перезагрузки

### 5.5 Правила оценивания (`/teacher/scoring-rules`)

- Создание шаблонов: имя, тип теста, класс, предмет (все необязательны как условие матча)
- Для каждого правила: список `номер задания → максимальный балл`
- Матчинг при парсинге и одобрении: case-insensitive, trim; побеждает наиболее специфичное правило (больше совпавших полей)
- Null-поле в правиле = wildcard (любое значение)

### 5.6 Ученики (`/teacher/students`)

- Список учеников организации с фильтрацией по статусу
- **Редактировать** (Pencil): изменить ФИО, класс, email, пароль
- **Деактивировать** (UserMinus, янтарный): `is_active=false` + удаляет назначения/членство в группах, история сохраняется
- **Удалить навсегда** (Trash2, красный): вызывает `delete_student_cascade()` RPC + удаляет `solution_requests`, `student_final_results`, профиль, auth-пользователя

### 5.7 Запросы на решения (`/teacher/solution-requests`)

- Студент запрашивает просмотр решения задания
- Учитель одобряет/отклоняет; при одобрении студент видит текст решения и изображения

---

## 6. Модули студента

### 6.1 Кабинет (`/student`)

- Список активных назначений с прогрессом (попыток использовано/доступно)
- Значок "Тест завершён (N/M)" когда все попытки исчерпаны

### 6.2 Тест-плеер (`/student/attempt/[id]`)

- Пагинация по заданиям, автосохранение ответов каждые 3 сек
- Типы ответов: `single_choice`, `multiple_choice`, `short_text`, `numeric`, `composite`, `manual_review`
- Заблокированные задания (`is_locked=true`): зелёный баннер "Задание засчитано", ввод отключён
- Таймер (если `time_limit_sec` задан)
- При второй попытке ответы из первой копируются с баллами и статусом блокировки

### 6.3 Результаты (`/student/attempt/[id]/result`)

- Показывает `student_final_results.final_score` (накопительный по всем попыткам)
- Если осталась ≥1 попытка: "Текущий результат: X/Y · попробовать ещё раз"
- Если попытки исчерпаны: "Итоговый результат"
- Комментарий учителя к каждому заданию
- Кнопка "Запросить решение" (если `access_policy=by_request`)

---

## 7. Пайплайн обработки тестов

### Поддерживаемые форматы

| Формат | Качество | Особенности |
|--------|---------|-------------|
| PaddleOCR JSON | ⭐⭐⭐ | Точные bbox, изображения вырезаются с оригинала страницы |
| Markdown (.md) | ⭐⭐ | Разметка `## N.` для заданий, `Решение.` / `Ответ:` |
| PDF | ⭐ | Текст через pdf-parse, AI (DeepSeek) для структурирования |

### Процесс

```
1. Учитель загружает файл → Storage bucket test-documents
2. POST /api/parsing/trigger → создаёт parsing_job
3. next/server `after()` запускает runParsing() асинхронно:
   ├── JSON: parseJsonPaddleOCR() → cropPageImage() → uploadJsonTaskImages()
   ├── MD:   parseMdContent() → downloadAndUploadMdImages()
   └── PDF:  extractPdfText() → callDeepSeek() → extractImagesWithPdfjs()
4. Задания записываются в test_tasks с max_score=1
5. applyMatchingScoringRules() → обновляет max_score из правила (если совпало)
6. parsing_job.status = 'done', test_version.status = 'in_review'
7. Учитель проверяет задания на ReviewBoard
8. Approve-all → review_status='approved' + повторное применение правила
9. Публикация → test_version.status='published'
```

### Структура PaddleOCR JSON

```json
[
  {
    "prunedResult": {
      "parsing_res_list": [
        {
          "block_label": "paragraph_title",
          "block_content": "## 1. Условие задания",
          "block_bbox": [x1, y1, x2, y2],
          "block_id": 0
        },
        { "block_label": "text", "block_content": "Текст условия..." },
        { "block_label": "image", "block_bbox": [...] },
        { "block_label": "text", "block_content": "Решение. ..." },
        { "block_label": "text", "block_content": "Ответ: 42" }
      ]
    },
    "inputImage": { "0": "h", "1": "t", ... }
  }
]
```

`block_label` значения: `paragraph_title`, `text`, `display_formula`, `image`, `chart`, `table`, `figure_title`, `header`, `footer`.

---

## 8. Система оценивания

### Накопительные попытки

```
Попытка 1: задания 1-10, учитель проверяет задания 1,3,5 → is_locked=true
Попытка 2: задания 1,3,5 заблокированы (не перезаписываются)
           студент отвечает на 2,4,6 → учитель проверяет
Итоговый балл = MAX(awarded_score) по каждому заданию за все попытки
```

Хранится в `student_final_results`:
- `final_score` — сумма лучших баллов per-task
- `max_score` — сумма max_score всех заданий
- `attempt_count` — число завершённых попыток
- `status` — `in_progress` | `completed`

### Автопроверка (`lib/grading/checker.ts`)

| Метод | Описание |
|-------|---------|
| `exact` | Точное совпадение строк |
| `normalized` | Lowercase, убраны пробелы/пунктуация |
| `numeric_tolerance` | Число ±1% погрешность |
| `set_match` | Совпадение множества слов |
| `contains` | Правильный ответ содержится в ответе студента |
| `manual` | Только учитель |

### Правила оценивания (scoring_rules)

Матчинг происходит в двух точках:
1. После парсинга (в `runParsing`)
2. После "Одобрить все" (в `approve-all/route.ts`)

Алгоритм выбора правила:
- Null-поле = wildcard
- Не-null поле должно совпадать (case-insensitive, trim)
- Побеждает правило с наибольшим числом совпавших ненулевых полей

---

## 9. API Reference

### Тесты

| Метод | Путь | Роль | Описание |
|-------|------|------|---------|
| `PATCH` | `/api/tests/[id]` | teacher | Обновить метаданные теста |
| `DELETE` | `/api/tests/[id]` | teacher | Удалить тест каскадно |
| `POST` | `/api/tests/[id]/toggle-active` | teacher | Вкл/выкл публикацию |
| `POST` | `/api/tests/versions/[id]/publish` | teacher | Опубликовать версию |
| `POST` | `/api/tests/versions/[id]/approve-all` | teacher | Одобрить все задания + применить правило |
| `POST` | `/api/parsing/trigger` | teacher | Запустить парсинг документа |

### Назначения

| Метод | Путь | Роль | Описание |
|-------|------|------|---------|
| `DELETE` | `/api/assignments/[id]` | teacher | Удалить назначение |

### Попытки

| Метод | Путь | Роль | Описание |
|-------|------|------|---------|
| `PATCH` | `/api/attempts/[id]/answers` | student | Сохранить ответ |
| `POST` | `/api/attempts/[id]/submit` | student | Сдать попытку |
| `PATCH` | `/api/attempts/[id]/grade` | teacher | Проверить попытку (баллы + финализация) |
| `GET/POST` | `/api/attempts/[id]/solution-requests` | student | Запросить/просмотреть решение |

### Правила оценивания

| Метод | Путь | Роль | Описание |
|-------|------|------|---------|
| `GET` | `/api/scoring-rules` | teacher | Список правил организации |
| `POST` | `/api/scoring-rules` | teacher | Создать правило |
| `PUT` | `/api/scoring-rules/[id]` | teacher | Обновить правило |
| `DELETE` | `/api/scoring-rules/[id]` | teacher | Удалить правило |

### Ученики

| Метод | Путь | Роль | Описание |
|-------|------|------|---------|
| `PATCH` | `/api/admin/students/[id]` | teacher | Обновить данные / `{action: 'deactivate'}` |
| `DELETE` | `/api/admin/students/[id]` | teacher | Полное удаление с каскадом |

---

## 10. Безопасность

### Меры защиты

| Угроза | Реализованная защита |
|--------|---------------------|
| Несанкционированный доступ | Supabase RLS на всех таблицах; каждый API route проверяет `getUser()` |
| IDOR (доступ к чужим данным) | Явная проверка `organization_id` во всех мутирующих routes |
| XSS через HTML таблицы/формулы | `rehype-raw` + `rehype-sanitize` в `MarkdownContent`; HTML-escaping в `MathText` до `innerHTML` |
| XSS через `dangerouslySetInnerHTML` | Удалено из `SolutionView`; заменено на `MarkdownContent` |
| SQL Injection | Supabase JS client использует параметризованные запросы |
| Утечка правильных ответов | `task_answer_keys` видны только teacher через RLS; student API не возвращает ключи |
| Изменение заблокированных ответов | `answers/route.ts` проверяет `is_locked` перед upsert |
| Перезапись засчитанных баллов | `grade/route.ts` bulk-проверяет locked перед обновлением |
| Обход ограничения попыток | `submit/route.ts` считает `completedAttempts >= maxAttempts` перед созданием попытки |

### Admin client

`createAdminClient()` (service role key) используется **только** после полной проверки auth+authz в том же route handler. Никогда не передаётся клиенту.

---

## 11. Деплой

### Процесс

```bash
# Dev → Main
git checkout main
git merge dev
git push origin main
# Vercel автоматически деплоит из main
```

### Vercel конфигурация (`vercel.json`)

```json
{
  "framework": "nextjs",
  "buildCommand": "next build",
  "outputDirectory": ".next",
  "functions": {
    "app/api/parsing/trigger/route.ts": { "maxDuration": 300 }
  }
}
```

Parsing route имеет `maxDuration: 300` секунд (PDFjs + sharp + DeepSeek могут работать долго).

---

## 12. Переменные окружения

| Переменная | Где | Описание |
|-----------|-----|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | URL проекта Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | Публичный anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Service role key (admin client) |
| `DEEPSEEK_API_KEY` | server only | API key для AI-парсинга PDF |

---

## Статус v1 (май 2026)

### Реализовано ✅

- Полный цикл: создание теста → парсинг → проверка → назначение → прохождение → оценивание → результаты
- Три парсера: PaddleOCR JSON, Markdown, PDF+AI
- Накопительная система попыток с блокировкой засчитанных заданий
- Правила оценивания с автоприменением
- KaTeX формулы, HTML таблицы, изображения из PDF
- Мониторинг в реальном времени
- Запросы на просмотр решений
- Управление учениками и группами (деактивация + полное удаление)
- Аналитика по результатам

### Не реализовано / Планируется

- Email уведомления
- Экспорт результатов в Excel/CSV
- Множественные организации (multi-tenant admin panel)
- Временны́е ограничения с принудительной сдачей по таймеру
- Тип задания `single_choice` / `multiple_choice` с автопарсингом вариантов из PDF
- Мобильное приложение
