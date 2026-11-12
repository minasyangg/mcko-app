# Миграции: что в репозитории и что в базе

Сверено 12.11.2026 с историей миграций боевой базы
(`supabase_migrations.schema_migrations`). Повторить сверку:

```sql
select version, name from supabase_migrations.schema_migrations order by version;
```

## Как применяются миграции

Проект работает с облачной базой Supabase; локальный `supabase db reset` не
используется. Миграция — это файл в `supabase/migrations/`, который применяется
к базе через Supabase MCP (`apply_migration`) или скриптом, записывающим строку
в историю. Имя в истории — имя файла без `.sql`.

Перед применением любую миграцию, меняющую права или политики, стоит прогнать в
откатываемой транзакции под ролями ученика и учителя — так проверялись 106–109.

## Расхождения между файлами и историей

Имена 86 файлов совпадают с историей один в один. Остальное — три группы.

### 1. Файл с номером, в истории — без номера (18 миграций)

Миграция применена, но в историю записана без числового префикса. Содержимое
то же, действий не требуется.

| Файл | Имя в истории |
|---|---|
| `009_harden_rls_org_isolation` | `harden_rls_org_isolation` |
| `010_grading_method_on_test_tasks` | `grading_method_on_test_tasks` |
| `036_book_problem_stats` | `book_problem_stats` |
| `037_doska_student_boards` | `doska_student_boards` |
| `043_doska_board_group` | `doska_board_group` |
| `049_storage_test_documents_update` | `storage_test_documents_update` |
| `050_auth_switch_log` | `auth_switch_log` |
| `051_attendance` | `attendance` |
| `052_assigned_problems_view` | `assigned_problems_view` |
| `053_drop_backup_034` | `drop_backup_034` |
| `054_registration_moderation` | `registration_moderation` |
| `055_tests_soft_delete` | `tests_soft_delete` |
| `086_revoke_anon_function_grants` | `revoke_anon_function_grants` |
| `087_assignment_sharing` | `assignment_sharing` |
| `088_fix_assignment_shares_group_leak` | `fix_assignment_shares_group_leak` |
| `089_fix_sharing_visibility_gaps` | `fix_sharing_visibility_gaps` |
| `090_fix_shared_with_me_join_chain` | `fix_shared_with_me_join_chain` |
| `091_fix_shared_with_me_sender_profile` | `fix_shared_with_me_sender_profile` |

Пять файлов без номера в репозитории (`add_preserve_answers_to_assignments`,
`add_scoring_rule_id_to_tests`, `add_sequence_grading_method`,
`canonical_topics`, `library_filter_indexes`) записаны в истории под теми же
именами — расхождения нет, просто у них нет префикса.

### 2. Файл есть, в истории записи нет (9 миграций)

Применены мимо истории — через SQL Editor или прямым подключением. Их
результат в базе есть (проверено по объектам), но по истории этого не видно.

| Файл | Что проверено в базе |
|---|---|
| `005_student_deletion` | функция `delete_student_cascade` |
| `056_transfer_attendance_journals_to_ivanova` | разовый перенос данных, по объектам не проверяется |
| `057_attempts_teacher_reviewed_at` | колонка `attempts.teacher_reviewed_at` |
| `058_late_group_join_hides_old_assignments` | функция `student_sees_group_assignment` |
| `059_roadmap_source_groups` | таблица `roadmap_source_groups` |
| `060_roadmap_source_groups_fixes` | та же таблица и её политики |
| `061_roadmap_source_groups_rls_hardening` | то же |
| `079_exam_task_topic_map` | таблица `exam_task_topic_map` |
| `080_fgos_curriculum` | таблица `fgos_curriculum` |

### 3. В истории есть, файла не было (4 миграции)

Восстановлены 12.11.2026 дословно из истории, с буквенным суффиксом по месту
в порядке применения:

| Файл | Что делает |
|---|---|
| `015a_tracker_assignments` | таблицы стороннего проекта tracker, созданы по ошибке |
| `015b_drop_orphaned_tracker_tables` | удаляет их же |
| `043a_doska_guest_open_by_link` | функция `doska_guest_open_link` — вход гостя по ссылке на доску |
| `086a_revoke_public_sync_function_grants` | отзыв прав у функций синхронизации программ |

## Что из этого следует

- Развернуть базу с нуля прогоном файлов по алфавиту нельзя: файлы без номера
  встанут в конец, а порядок важен. Точный порядок применения — в истории базы.
- Новые миграции: следующий свободный номер, имя файла = имя в истории, и
  применять так, чтобы запись в историю появлялась (группа 2 возникла именно
  из-за применения мимо истории).
