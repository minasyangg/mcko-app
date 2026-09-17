---
name: homework-from-books
description: Собирает черновик ДЗ (домашнего задания) на сайте из заданий уже импортированных книг (book_problems) по заданной теме/классу — создаёт test+test_version в статусе draft и переносит туда задания, аналогично ручному потоку "книга → + → добавить в тест".
---

# Сборка ДЗ по книгам

Формирует новый черновик ДЗ (`tests.kind='homework'`, статус `draft`) и
наполняет его заданиями из уже импортированных книг (`book_problems`), не
трогая внешнюю библиотеку ФИПИ/sdamgia (`library_problems`) — только модуль
«Книги». Воспроизводит ровно то, что делает API `POST
/api/books/problems/[id]/add-to-test` (см. `app/api/books/problems/[id]/
add-to-test/route.ts`), но пакетно и без похода через UI/HTTP — прямыми SQL
через `scripts/supabase-query.mjs`.

## Когда использовать

Пользователь просит «собери ДЗ по теме X для класса Y», «сделай домашку из
книги», «нужно N заданий на тему ... + M заданий на тему ...» — источник
заданий не назван явно как библиотека ФИПИ/своя подборка — только книги.

## Вход, который нужно получить от пользователя (или уточнить)

- **Класс и предмет** (например «9 класс», «математика»/«алгебра»).
- **Темы и количество заданий на каждую** («область определения функции — 5
  заданий», «сокращение дробей — 2 задания»).
- **Черновик или сразу публиковать** — по умолчанию черновик (`draft`), не
  публиковать без явной просьбы (публикация — необратимый для учеников шаг,
  требует отдельного подтверждения).
- **От имени какого учителя создавать** — если не очевиден единственный
  подходящий профиль (например staging/демо-окружение с несколькими тестовыми
  учителями), спросить пользователя явно (`AskUserQuestion`), не выбирать
  самостоятельно между несколькими правдоподобными вариантами — это видимая
  для других людей сущность в системе.

## Пошагово

### 1. Найти книги и разделы по теме

Все SQL — через `scripts/supabase-query.mjs`, не через Supabase MCP execute_sql
(тот тоже можно, но `supabase-query.mjs` не тратит вызов MCP-инструмента и
стабильно доступен из скилов/субагентов). SQL — **не через `echo`/`printf` в
Bash** (шелл теряет экранирование в строках с кавычками/LaTeX) — `Write`
payload `{"sql": "..."}` в `.claude/tmp/query-<имя>.json`, затем `node
scripts/supabase-query.mjs < файл`, затем `rm` файл.

```sql
select b.id as book_id, b.title, bs.id as section_id, bs.title as section_title
from books b join book_sections bs on bs.book_id = b.id
where b.grade = '<класс>' and b.subject ilike '%<предмет>%'
  and (bs.title ilike '%<ключевое слово темы 1>%' or bs.title ilike '%<синоним>%')
order by b.title, bs.title;
```

Если заголовок раздела не находится (тема размазана по разделам повторения/
контрольных, а не оформлена отдельным параграфом — частый случай для старших
классов), искать по тексту условия:

```sql
select b.title as book_title, bs.title as section_title, bp.id, bp.task_number,
       bp.answer_source, bp.has_images, left(bp.prompt_md, 100) as preview
from book_problems bp
join book_sections bs on bs.id = bp.section_id
join books b on b.id = bp.book_id
where b.grade = '<класс>' and b.subject ilike '%<предмет>%'
  and (bp.prompt_md ilike '%<фраза из условия, напр. сократ%дроб%>%'
    or bp.prompt_md ilike '%<синоним, напр. упрост%выражен%>%')
order by b.title, bp.task_number
limit 40;
```

Несколько книг подходят под класс/предмет — не выбирать по своему усмотрению
без основания; учебник (`book_type='textbook'`) обычно лучше подходит для ДЗ
на новую тему, дидактические материалы (`book_type='didactic'`) — на закрепление/
контроль. При сомнении — короткая сводка пользователю, что нашлось где.

### 2. Отобрать конкретные задания

Внутри найденного раздела/выборки:
- Предпочитать `has_images=false` (без картинок — не создают доп. риска
  показа сломанной картинки/зависимости от Storage) — картинки допустимы,
  если тема без них не покрывается и пользователь не просил иначе.
- Предпочитать `answer_source='book_answers'` (эталон уже есть, дал сам
  учебник) — надёжнее, чем `answer_source='none'`, для которых ответ придётся
  придумывать самостоятельно на шаге 5.
- Разброс по сложности — не пять однотипных заданий подряд; посмотреть
  `prompt_md` перед выбором, не полагаться только на номер/заголовок раздела.
- Прочитать `prompt_md` каждого кандидата перед финальным выбором — превью
  в 100 символов достаточно для отсева, но не для решения "подходит ли по
  теме".

Собрать итоговый список `problem_id` в нужном порядке (порядок — по
возрастанию сложности внутри темы, темы по порядку, в котором их назвал
пользователь).

### 3. Определить владельца (`created_by`/`organization_id`)

```sql
select id, email, role, organization_id, full_name
from profiles where role in ('teacher','admin') order by created_at limit 15;
```

Один явный подходящий профиль (например единственный teacher в проекте,
привязанный к организации) — использовать его без лишних вопросов. Несколько
правдоподобных вариантов (демо-организация + отдельные личные аккаунты без
org, разные школы) — спросить пользователя, под каким учителем создавать
черновик (`AskUserQuestion`), сохранить его выбор в памяти проекта на будущее,
если это регулярный сценарий.

`tests.organization_id` — `NOT NULL`, обязательно взять из
`profiles.organization_id` выбранного учителя (не выдумывать / не оставлять
null).

### 4. Создать черновик ДЗ

```sql
insert into tests (organization_id, title, subject, grade, kind, status, description, created_by)
values ('<org_id>', '<заголовок ДЗ>', '<предмет>', '<класс>', 'homework', 'draft',
        '<короткое описание: из какой книги/разделов>', '<teacher_id>')
returning id;

insert into test_versions (test_id, version_number, status)
values ('<test_id>', 1, 'draft')
returning id;
```

`title` — сформулировать по темам ДЗ (не «ДЗ №1»), пользователю потом легко
узнать его в списке. `description` — какая книга и какие разделы источник,
это полезно при повторном открытии черновика через месяц.

### 5. Перенести задания — по одному, воспроизводя `add-to-test`

Для каждого `problem_id` из отобранного списка (шаг 2), по порядку,
`task_number`/`sort_order` = позиция в списке (с 1):

1. Прочитать задание:
   ```sql
   select id, task_number, prompt_md, task_type, grading_method, options,
          has_images, correct_answer, answer_source, used_count
   from book_problems where id = '<problem_id>' and is_active = true;
   ```
2. Если `correct_answer` не пустой — привести его к тексту эталона:
   `correct_answer` у книг хранится как `{"text": "..."}` (не голой строкой) —
   взять `.text`.
3. Разобрать эталон на составные части тем же алгоритмом, что использует
   `add-to-test` (`buildCompositeAnswerKey` из `lib/grading/multi-part-answer.ts`,
   есть готовая копия без TS-алиасов в `scripts/lib/multi-part-answer.mjs`,
   используемая `classify-answer.mjs`) — **не переписывать эту логику вручную
   по памяти**, чтобы формат составного ответа (`{"parts": {"а": {"value":
   ..., "method": ...}}}`) не разошёлся с тем, что понимает проверяющий код.
   Практически: тем же приёмом Write→Bash→rm вызвать
   `node scripts/classify-answer.mjs` с `{"promptMd": "<prompt_md>",
   "answerText": "<текст эталона из correct_answer.text>"}` — он внутри уже
   зовёт `buildCompositeAnswerKey`/`detectGradingMethod` и вернёт готовые
   `cleanedAnswer`/`gradingMethod`/`isComposite`/`correctAnswerJson`/`answerParts`.
4. Вставить задание:
   ```sql
   insert into test_tasks (test_version_id, task_number, sort_order, prompt_text,
     prompt_html, task_type, grading_method, options, max_score, has_images,
     review_status, book_problem_id, answer_parts)
   values ('<version_id>', <N>, <N>, '<текст без LaTeX/html, короткое резюме>',
     '<prompt_md как есть>', '<composite ? "composite" : problem.task_type>',
     '<composite ? "normalized" : problem.grading_method>', '<options::jsonb>',
     <max_score>, <has_images>, 'approved', '<problem_id>',
     '<answerParts::jsonb, или "[]" если не составной>')
   returning id;
   ```
   `prompt_text` — плоский текст для превью (без LaTeX/HTML), можно взять
   первые ~150 символов `prompt_md` с грубой зачисткой `$...$`/`<...>` —
   точная копия regex не критична, это только служебное поле для списков.

   **`max_score` = число пунктов а)/б)/в)/г) в номере (1 балл за каждый
   пункт по умолчанию), не 1 балл за весь номер.** Составной ответ
   (`task_type='composite'`) с `answer_parts.length === N` → `max_score = N`.
   Не составной (один сплошной ответ без меток пунктов) → `max_score = 1`.
   Механика: `checkAnswer` в `lib/grading/checker.ts` считает
   `awarded_score = (correctCount / labels.length) × maxScore` — при
   `maxScore = labels.length` это ровно "по 1 целому баллу за каждый верный
   пункт" (напр. 3 из 4 верных → 3 балла), а не дробная доля от одного балла.
   Другое значение — только если пользователь явно попросил другую
   балльность для конкретного номера.
5. Если у задания был эталон — записать ключ:
   ```sql
   insert into task_answer_keys (task_id, correct_answer, grading_method)
   values ('<task_id>', '<correctAnswerJson либо {"text": "..."}, как ::jsonb>',
           '<composite ? "normalized" : problem.grading_method>');
   ```
6. Инкрементировать счётчик использования книги:
   ```sql
   update book_problems set used_count = coalesce(used_count, 0) + 1 where id = '<problem_id>';
   ```

Каждый insert — отдельная проверка, что вставилось (rowCount/вернувшийся id);
на ошибке — остановиться и сообщить, не продолжать молча с частично собранным
ДЗ.

### 6. Задания без готового ответа — решить самостоятельно

Для заданий, у которых `correct_answer is null` (`answer_source='none'`) — не
оставлять `test_tasks` без `task_answer_keys`: ДЗ без эталона нельзя
автоматически проверить.

- Решить задание собственным рассуждением (та же модель, что ведёт эту
  сессию, без DeepSeek/отдельного API ключа — как это делает
  `.claude/skills/book-answer-reviewer` для книг целиком). Для точных
  вычислений — предпочитать `sympy`/`python3 -c` над устным счётом,
  особенно для сокращения дробей/раскрытия скобок, где легко ошибиться в
  знаке.
- Прогнать результат через `classify-answer.mjs` тем же способом, что и на
  шаге 5.3, — получить `cleanedAnswer`/`gradingMethod`/`isComposite`.
- Записать `task_answer_keys` (шаг 5.5) с полученным форматом.
- **Дополнительно** обновить сам `book_problems`, чтобы решение не терялось
  и пригодилось при следующей сборке ДЗ из этой же книги:
  ```sql
  update book_problems
  set correct_answer = '<в форме {"text": "а) ...; б) ..."} для составных,
                          либо {"text": "<simple>"} для простых>'::jsonb,
      answer_source = 'manual',
      updated_at = now()
  where id = '<problem_id>' and answer_source = 'none';
  ```
  `answer_source='manual'` (не `'ai'`) — это решение записано в рамках именно
  сборки ДЗ, а не массового ИИ-ревью книги; `add-to-test`/будущие запуски
  этого же скила уважают `answer_source !== 'manual'` как «не трогать
  повторно».
- Если задание с картинкой (`has_images=true`) без эталона — не решать
  вслепую по превью текста; пропустить и явно предупредить пользователя в
  итоговом отчёте, что это задание добавлено без проверяемого ответа
  (учителю нужно проверить вручную либо вписать ответ через UI).

### 7. Проверка и отчёт

```sql
select t.id as test_id, t.title, t.status as test_status, tv.id as version_id,
  (select count(*) from test_tasks tt where tt.test_version_id = tv.id) as tasks_count,
  (select count(*) from test_tasks tt join task_answer_keys k on k.task_id = tt.id
   where tt.test_version_id = tv.id) as tasks_with_answer
from tests t join test_versions tv on tv.test_id = t.id
where t.id = '<test_id>';
```

`tasks_count` должно равняться запрошенному числу заданий, `tasks_with_answer`
— в идеале равно `tasks_count` (после шага 6). Доложить пользователю на
русском: заголовок ДЗ, `test_id`, откуда взяты задания (книга/раздел/номера),
сколько заданий и сколько из них с готовым ответом «из книги» против
«решено самостоятельно на этом шаге» — учителю важно знать, что стоит
выборочно перепроверить перед публикацией.

## Ограничения

- Не публикует ДЗ (`status` остаётся `draft`) — публикация делает версию
  неизменяемой и видимой для назначения ученикам, это отдельный явный шаг
  учителя через UI либо отдельная явная просьба пользователя.
- Не трогает `library_problems`/глобальную библиотеку ФИПИ — только книги
  (`book_problems`). Если пользователь просит смешать книги и библиотеку,
  уточнить/использовать зеркальный `add-to-test` для библиотеки отдельно
  (за пределами этого скила).
- Не проверяет дубликаты выдачи (`/api/assignments/duplicates` — это про уже
  назначенные ученикам задания, черновик ДЗ никому не назначен, проверять
  нечего до публикации+назначения).
- Задания с картинками без эталона — не решаются автоматически (см. шаг 6),
  остаются без `task_answer_keys`, попадают в отчёт как «требуют внимания
  учителя».
