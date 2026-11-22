---
name: homework-agent-build
description: Собирает черновик ДЗ для программы (roadmap) — по подтверждённому (status='confirmed') предложению агента автосборки или по прямой просьбе «собери ДЗ по теме X»: берёт широкий пул кандидатов по теме, сам читает текст каждого и отбирает подходящие по смыслу, вставляет их в новый тест.
model: sonnet
---

# Сборка ДЗ для программы

Сервер ДЗ сам не собирает (cron и `pick-problems.ts` удалены): этот скилл —
единственный путь. Широкий SQL-фильтр даёт кандидатов «предположительно по
теме», финальный отбор — по смыслу текста каждого задания. Если пользователь
прямо называет книгу и тему — это `.claude/skills/homework-from-books`.

## Параметры

| Параметр | По умолчанию | Примечание |
|---|---|---|
| Программа / предложение | — (обязателен) | Название roadmap или `proposalId`; иначе все `status='confirmed'` (шаг 1), по нескольким программам — за один заход. Прямая просьба «собери ДЗ по теме X» — предложение не нужно |
| Тема | из предложения | Можно переопределить на другую подтему кодификатора |
| `task_count` | `roadmap_agent_rules.task_count` | Фиксированное число; можно задать в запросе |
| Режим учёта ошибок | автоматически A/B | C — только по явной просьбе, см. ниже |
| Публиковать сразу | нет (черновик) | Только по явной просьбе или `publish_immediately=true` |
| Источники | `roadmap_agent_rule_sources` | Можно указать книгу/раздел в запросе |

`teacher_id`/`organization_id` берутся из предложения (шаг 1) или из программы
(`roadmaps.created_by`, `organization_id`) — не спрашивать.

## Правила работы

- SQL — через `scripts/supabase-query.mjs` (JSON `{"sql": "..."}` через stdin,
  тело запроса писать файлом через Write, не `echo` — ломается экранирование).
  Выбирать только нужные колонки, всегда `limit`.
- **Сеть до Supabase рвётся** (`fetch failed`, таймауты, `UND_ERR_*`) — не
  повторять самому и не крутить циклы перезапуска: остановиться и выдать
  пользователю готовую команду запуска + что ожидать в выводе.
- Временные файлы (спецификация, запросы, картинки) — в scratchpad сессии.

## Режимы учёта ошибок

Перед шагом 3.5 проверить, было ли ДЗ в этой теме (тот же `roadmap_topic_id`
или его ветка кодификатора):

```sql
select count(*) as prior_homework_count from assignments a
where a.roadmap_topic_id in (<id темы + предки/потомки ветки>) and a.kind = 'homework';
```

- **A** (`= 0`, тема новая) — шаг 3.5 пропускается, состав по подтемам темы.
- **B** (`> 0`) — шаг 3.5 обязателен, ошибки только по заданиям того же
  поддерева кодификатора, `kind` test+homework вместе.
- **C** (только по явной просьбе: «учти ошибки в пробниках») — ошибки только
  `kind='test'` по всей программе; каждый кластер сверить с уже заданными ДЗ
  по всем темам: закрыт и не повторяется — не дублировать, повторяется после ДЗ —
  приоритет. Если кластеры покрывают несколько тем — сказать, что ДЗ межтемное,
  и спросить, к какой теме программы привязать.

## Пошагово

### 1. Предложение и контекст

```sql
select p.id as proposal_id, p.roadmap_id, p.rule_id, p.organization_id, p.teacher_id,
       p.roadmap_topic_id, p.proposed_title, p.final_title, p.publish_immediately,
       rt.library_topic_id, r.title as roadmap_title, lt.name as topic_name, lt.fipicod
from homework_proposals p
join roadmaps r on r.id = p.roadmap_id
left join roadmap_topics rt on rt.id = p.roadmap_topic_id
left join library_topics lt on lt.id = rt.library_topic_id
where p.status = 'confirmed' order by p.confirmed_at desc limit 20;
```

Колонка — `fipicod` (не `fipi_code`). Пустой `library_topic_id` — собрать
нельзя, сообщить и перейти к следующему предложению. Название ДЗ — по образцу
уже существующих ДЗ этой программы (посмотреть их названия).

### 1.5. Раскрыть родительскую тему

```sql
select id, fipicod, name, parent_id from library_topics
where id = '<library_topic_id>' or parent_id = '<library_topic_id>' limit 50;
```

Есть дети — дальше искать по списку id детей (у родительских кодов
`library_problems.topic_id` почти всегда пуст); нет — лист, искать по нему.

### 2. Правило и источники

```sql
select ars.source_kind, ars.book_id, ars.library_topic_id, ars.exam_type, ars.subject, ars.weight,
       r.task_count, r.mistakes_pct, r.difficulty, r.allow_images, r.require_answer
from roadmap_agent_rule_sources ars join roadmap_agent_rules r on r.id = ars.rule_id
where ars.rule_id = '<rule_id>' limit 20;
```

### 3. Пул кандидатов — коротким текстом

Выгружать только начало условия (300 символов); полный текст и `prompt_html`
— только для отобранных на шаге 4.

Библиотека (`library_topic`/`library_exam`):

```sql
select lp.id, lt.fipicod as matched_subtopic, lp.task_number_type, lp.has_answer, lp.correct_answer,
       lp.default_max_score, lp.used_count,
       exists (select 1 from library_problem_media m
               where m.library_problem_id = lp.id and m.placement <> 'solution') as has_condition_images,
       left(replace(lp.prompt_text, chr(173), ''), 300) as p
from library_problems lp
left join library_topics lt on lt.id = coalesce(lp.canonical_topic_id, lp.topic_id)
where (lp.topic_id in (<темы из 1.5>) or lp.canonical_topic_id in (<тот же список>))
  and lp.is_active and (<require_answer=false> or lp.has_answer)
order by lp.used_count asc
limit <task_count * 3>;
```

Книга — `section_id` не связан с кодификатором, отбирать по тексту:

```sql
select bp.id, bp.task_number, bp.correct_answer, bp.answer_source, bp.has_images, bp.used_count,
       left(bp.prompt_md, 300) as p
from book_problems bp
where bp.book_id = '<book_id>' and bp.is_active
  and (<require_answer=false> or (bp.answer_source <> 'none' and bp.correct_answer is not null))
  and (<allow_images=true> or not bp.has_images)
order by bp.used_count asc
limit <task_count * 4>;
```

Практико-ориентированные задания 1–5 ОГЭ по математике (квартира, тарифы, шины,
план местности, баня…) брать из блоков 1–5 пробников на сайте (`tests.kind='test'`),
а не из библиотеки: у Решу ОГЭ при импорте потерян сам вопрос — в условии только
общий текст и рисунок. В спецификации это элемент `task` (формат — в
`spec.example.mjs`); общий текст и рисунок блока в тесте есть только у первого
задания — остальным приложить его рисунок (`media`) и ссылку на задание с условием.

Если пул по теме мал — поиск по тексту условия (`~*` по ключевым словам темы,
`replace(prompt_text, chr(173), '')` — у Решу ОГЭ/ЕГЭ мягкие переносы).

Исключить задания, назначенные этим учителем за 60 дней:

```sql
select library_problem_id, book_problem_id from assigned_problems
where teacher_id = '<teacher_id>' and assigned_at > now() - interval '60 days' limit 1000;
```

### 3.5. Ошибки группы (режимы B и C)

```sql
select t.kind, tt.id as task_id, tt.task_number, left(tt.prompt_text, 300) as p, tt.has_images,
       count(distinct at.student_id) as students_wrong
from attempt_task_answers ata
join attempts at on at.id = ata.attempt_id
join test_tasks tt on tt.id = ata.task_id
join test_versions tv on tv.id = tt.test_version_id
join tests t on t.id = tv.test_id
where ata.is_correct = false and at.status in ('submitted','checked')
  and at.student_id in (<ученики программы>)
  and at.submitted_at > now() - interval '<mistakes_lookback_days> days'
  -- B: and tt.id in (<задания поддерева темы>)   C: and t.kind = 'test'
group by 1,2,3,4,5 order by students_wrong desc limit 100;
```

Группировать по проверяемому навыку, не по `task_number` (один навык ходит
под разными номерами). Доля кластера `p` = уникальные ученики с ошибкой в
кластере / все ученики программы.

### 4. Отбор по смыслу — не пропускать, не брать первые N

- Сначала кластеры ошибок по убыванию `p`: кандидат должен совпасть и по форме
  задачи, и по навыку. Сколько задач на кластер — плавно по `p`: `p < 10%` →
  1 задача, `p ≈ 50%` → около трети состава, `p → 100%` → до ~75%; конкурирующие
  кластеры — пропорционально `p`.
- Остаток — по подтемам темы: минимум 1 задание на подтему с подходящими
  кандидатами, не больше 2 одинаковых формулировок; близнецы (одна задача с
  другими числами) — разносить по разным ДЗ, а не ставить рядом.
- Набирается меньше `task_count * 0.5` — не тянуть посторонние задачи:
  сообщить, что источников мало, предложить расширить источники или снизить
  `task_count`. Фильтры `require_answer`/`allow_images` ослаблять можно,
  тему и сложность — нет.

### 5. Проверка каждого отобранного задания

1. **Ответ есть и чистый**: числа по каждому пункту, без обрывков OCR и хвостов
   соседних номеров («…8.35. а)…»), LaTeX в `$…$`, парные `\left`/`\right` и `{}`,
   нет `\cup \cup`, `.` или половины интервала вместо ответа.
2. **Ответа нет или он битый** — решить самому (sympy для точных вычислений,
   `scripts/classify-answer.mjs` для формата). Книге записать исправленный
   ответ обратно (`answer_source='manual'`); общую библиотеку не трогать —
   исправление живёт только в ключе теста. Шаблонные задания ФИПИ/Решу ОГЭ
   иногда несут чужой эталон — пересчитывать.
3. **Ответ зависит от рисунка** — открывать рисунок, только если эталона из
   источника нет или он сомнителен. Все такие рисунки — одной HTML-страницей
   и одним скриншотом headless Chrome, не по одному. `file_*.png` у Решу
   ОГЭ/ЕГЭ бывают SVG; формулы-картинки читаются по `alt`.
4. Варианты ответа без `options` (ФИПИ `single_choice`/`multiple_choice`) —
   ставить `numeric` + подсказку «Номер верного варианта.»; «две цифры в любом
   порядке» — ключ `45|54`.
5. Вторая часть «с решением» — ручная проверка (`grading_method='manual'` у
   ключа): плеер не даст сдать работу без фото решения. Условие переписать
   начисто, эталонное решение с критериями — в `task_solutions`.

### 6. Сборка — готовым скриптом

Записать спецификацию в scratchpad по образцу
`.claude/skills/homework-agent-build/spec.example.mjs` (формат — в его шапке),
затем из корня репозитория:

```bash
NODE_EXTRA_CA_CERTS=<корневой сертификат Avast, .pem> \
  node .claude/skills/homework-agent-build/build.mjs <scratchpad>/spec.mjs
node .claude/skills/homework-agent-build/verify.mjs <scratchpad>/built.json --fix-media
```

`build.mjs` вставляет задания функциями сайта (`addLibraryProblemToVersion`/
`addBookProblemToVersion`: медиа копируются в `task-media`, `used_count`
растёт), правит ключи и решения; повторный запуск дособирает черновик с места
обрыва. `verify.mjs` показывает число заданий и баллов, задания без ключа,
эталоны, не прошедшие настоящий `checkAnswer`, и удаляет битые вложения
(у ФИПИ часть «рисунков» — HTML-страницы ошибки на 278 байт).

Сеть оборвалась — выдать эти команды пользователю (правило выше).

### 7. Предложение, публикация, отчёт

```sql
update homework_proposals set status = 'built', test_id = '<test_id>', updated_at = now()
where id = '<proposal_id>';
```

Публикация — только по явной просьбе или `publish_immediately`: инварианты
`lib/tests/publish.ts` (все задания `review_status='approved'`, у каждого есть
ключ), затем `assignments` с `roadmap_topic_id`, `kind='homework'`, `group_id`
программы — как после `publishResult` в справочном `lib/homework-agent/build.ts`.
Ошибка публикации — предложение в `failed` с `build_error`.

Отчёт на русском: тема, `test_id`, сколько кандидатов рассмотрено и отобрано
(книга/библиотека), паттерны отсева одной фразой, сколько ответов из источника
и сколько решено самостоятельно; если опирались на ошибки — кластеры и их `p`.

## Ограничения

- По умолчанию не публикует.
- Предложения не в статусе `confirmed` не трогает; пересборка `built`/`failed` —
  только после явного отката (удалить черновик: `test_tasks`, `task_answer_keys`,
  `test_versions`, `tests`; обнулить `current_published_version_id` до удаления версий).
- Не меняет `roadmap_agent_rules`/`roadmap_agent_rule_sources`.
