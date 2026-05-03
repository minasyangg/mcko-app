-- ============================================================
-- seed.sql — Тестовые данные для ExamPlatform
-- ============================================================
-- Организация: МЦКО Демо
-- Admin:   admin@mcko.test   / Admin123!
-- Teacher: teacher@mcko.test / Teacher123!
-- Student: student@mcko.test / Student123!
-- ============================================================

-- 1. Организация
INSERT INTO public.organizations (id, name, slug, settings, created_at)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    'МЦКО — Демо',
    'mcko-demo',
    '{}',
    now()
) ON CONFLICT (id) DO NOTHING;

-- 2. Пользователи в auth.users (email_confirmed_at = now() → без подтверждения)

-- Admin
INSERT INTO auth.users (
    id, instance_id, aud, role,
    email, encrypted_password,
    email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES (
    '22222222-2222-2222-2222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'admin@mcko.test',
    crypt('Admin123!', gen_salt('bf', 10)),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Администратор","role":"admin"}',
    now(), now(),
    '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

-- Teacher
INSERT INTO auth.users (
    id, instance_id, aud, role,
    email, encrypted_password,
    email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES (
    '33333333-3333-3333-3333-333333333333',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'teacher@mcko.test',
    crypt('Teacher123!', gen_salt('bf', 10)),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Иванова Мария Петровна","role":"teacher"}',
    now(), now(),
    '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

-- Student
INSERT INTO auth.users (
    id, instance_id, aud, role,
    email, encrypted_password,
    email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES (
    '44444444-4444-4444-4444-444444444444',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'student@mcko.test',
    crypt('Student123!', gen_salt('bf', 10)),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Петров Алексей Иванович","role":"student"}',
    now(), now(),
    '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

-- 3. Email identities (нужны для входа через email/password)
INSERT INTO auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, provider_id)
VALUES
    (
        '22222222-2222-2222-2222-222222222223',
        '22222222-2222-2222-2222-222222222222',
        '{"sub":"22222222-2222-2222-2222-222222222222","email":"admin@mcko.test","email_verified":true}',
        'email', now(), now(), now(), 'admin@mcko.test'
    ),
    (
        '33333333-3333-3333-3333-333333333334',
        '33333333-3333-3333-3333-333333333333',
        '{"sub":"33333333-3333-3333-3333-333333333333","email":"teacher@mcko.test","email_verified":true}',
        'email', now(), now(), now(), 'teacher@mcko.test'
    ),
    (
        '44444444-4444-4444-4444-444444444445',
        '44444444-4444-4444-4444-444444444444',
        '{"sub":"44444444-4444-4444-4444-444444444444","email":"student@mcko.test","email_verified":true}',
        'email', now(), now(), now(), 'student@mcko.test'
    )
ON CONFLICT (provider, provider_id) DO NOTHING;

-- 4. Профили: привязка к организации
-- (триггер handle_new_user уже создал записи при INSERT auth.users)
UPDATE public.profiles
SET organization_id = '11111111-1111-1111-1111-111111111111',
    role = 'admin', full_name = 'Администратор'
WHERE id = '22222222-2222-2222-2222-222222222222';

UPDATE public.profiles
SET organization_id = '11111111-1111-1111-1111-111111111111',
    role = 'teacher', full_name = 'Иванова Мария Петровна'
WHERE id = '33333333-3333-3333-3333-333333333333';

UPDATE public.profiles
SET organization_id = '11111111-1111-1111-1111-111111111111',
    role = 'student', full_name = 'Петров Алексей Иванович', grade = '10'
WHERE id = '44444444-4444-4444-4444-444444444444';

-- 5. Группа + участник
INSERT INTO public.groups (id, organization_id, name, description, created_by, created_at)
VALUES (
    '55555555-5555-5555-5555-555555555555',
    '11111111-1111-1111-1111-111111111111',
    '10А', 'Тестовый класс',
    '33333333-3333-3333-3333-333333333333', now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.group_members (group_id, user_id, added_at)
VALUES ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444', now())
ON CONFLICT (group_id, user_id) DO NOTHING;

-- 6. Тест + версия (published)
INSERT INTO public.tests (
    id, organization_id, title, subject, grade, exam_type,
    description, status, current_published_version_id, created_by, created_at, updated_at
) VALUES (
    '66666666-6666-6666-6666-666666666666',
    '11111111-1111-1111-1111-111111111111',
    'Пробный тест — Математика 10 класс', 'Математика', '10', 'Контрольная',
    'Демонстрационный тест для проверки платформы',
    'published', null,
    '33333333-3333-3333-3333-333333333333', now(), now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.test_versions (
    id, test_id, version_number, status,
    time_limit_sec, max_attempts, shuffle_tasks, result_visibility, scoring_policy,
    published_at, published_by, created_at
) VALUES (
    '77777777-7777-7777-7777-777777777777',
    '66666666-6666-6666-6666-666666666666',
    1, 'published', 1800, 2, false, 'after_submit', '{}',
    now(), '33333333-3333-3333-3333-333333333333', now()
) ON CONFLICT (id) DO NOTHING;

UPDATE public.tests
SET current_published_version_id = '77777777-7777-7777-7777-777777777777'
WHERE id = '66666666-6666-6666-6666-666666666666';

-- 7. Задачи

-- Задача 1: одиночный выбор
INSERT INTO public.test_tasks (
    id, test_version_id, task_number, sort_order, prompt_text, task_type,
    options, max_score, review_status, parse_confidence, created_at
) VALUES (
    '88888888-8888-8888-8888-888888888881',
    '77777777-7777-7777-7777-777777777777',
    1, 1, 'Какое из чисел является простым?', 'single_choice',
    '[{"id":"a","text":"4"},{"id":"b","text":"7"},{"id":"c","text":"9"},{"id":"d","text":"15"}]',
    1, 'approved', 0.95, now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.task_answer_keys (task_id, correct_answer, grading_method, grading_config)
VALUES ('88888888-8888-8888-8888-888888888881', '{"selected":"b"}', 'exact', '{}')
ON CONFLICT (task_id) DO NOTHING;

-- Задача 2: числовой ответ
INSERT INTO public.test_tasks (
    id, test_version_id, task_number, sort_order, prompt_text, task_type,
    answer_format_hint, max_score, review_status, parse_confidence, created_at
) VALUES (
    '88888888-8888-8888-8888-888888888882',
    '77777777-7777-7777-7777-777777777777',
    2, 2, 'Вычислите: 15 × 8 − 20 ÷ 4', 'numeric',
    'Введите целое число', 1, 'approved', 0.95, now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.task_answer_keys (task_id, correct_answer, grading_method, grading_config)
VALUES ('88888888-8888-8888-8888-888888888882', '{"value":"115"}', 'numeric_tolerance', '{"tolerance":0}')
ON CONFLICT (task_id) DO NOTHING;

-- Задача 3: короткий текст
INSERT INTO public.test_tasks (
    id, test_version_id, task_number, sort_order, prompt_text, task_type,
    answer_format_hint, max_score, review_status, parse_confidence, created_at
) VALUES (
    '88888888-8888-8888-8888-888888888883',
    '77777777-7777-7777-7777-777777777777',
    3, 3, 'Найдите НОД чисел 12 и 18.', 'short_text',
    'Запишите только число', 2, 'approved', 0.90, now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.task_answer_keys (task_id, correct_answer, grading_method, grading_config)
VALUES ('88888888-8888-8888-8888-888888888883', '{"text":"6"}', 'normalized', '{}')
ON CONFLICT (task_id) DO NOTHING;

-- Задача 4: множественный выбор
INSERT INTO public.test_tasks (
    id, test_version_id, task_number, sort_order, prompt_text, task_type,
    options, max_score, review_status, parse_confidence, created_at
) VALUES (
    '88888888-8888-8888-8888-888888888884',
    '77777777-7777-7777-7777-777777777777',
    4, 4, 'Выберите все простые числа из списка:', 'multiple_choice',
    '[{"id":"a","text":"2"},{"id":"b","text":"4"},{"id":"c","text":"11"},{"id":"d","text":"15"},{"id":"e","text":"17"}]',
    2, 'approved', 0.92, now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.task_answer_keys (task_id, correct_answer, grading_method, grading_config)
VALUES ('88888888-8888-8888-8888-888888888884', '{"selected":["a","c","e"]}', 'set_match', '{"partial_credit":true}')
ON CONFLICT (task_id) DO NOTHING;

-- 8. Назначение теста группе 10А
INSERT INTO public.assignments (
    id, test_version_id, organization_id,
    group_id, student_id, starts_at, ends_at, max_attempts, created_by, created_at
) VALUES (
    '99999999-9999-9999-9999-999999999999',
    '77777777-7777-7777-7777-777777777777',
    '11111111-1111-1111-1111-111111111111',
    '55555555-5555-5555-5555-555555555555', null,
    now(), now() + interval '30 days',
    2, '33333333-3333-3333-3333-333333333333', now()
) ON CONFLICT (id) DO NOTHING;
