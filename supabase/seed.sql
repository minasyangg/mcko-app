-- ============================================================
-- seed.sql - Инициальные данные для тестирования
-- ============================================================

-- Создаем организацию
INSERT INTO organizations (name, slug, settings)
VALUES (
  'MinGG School',
  'mingg-school',
  '{"timezone": "Europe/Moscow", "language": "ru"}'
)
ON CONFLICT (slug) DO NOTHING;

-- Получаем ID организации
WITH org AS (
  SELECT id FROM organizations WHERE slug = 'mingg-school'
)
-- Создаем профиль admin пользователя
-- ВАЖНО: Сначала нужно создать пользователя в auth.users через Supabase Auth,
-- потом добавить его в profiles таблицу
INSERT INTO profiles (id, organization_id, full_name, role, is_active)
SELECT 
  auth_users.id,
  org.id,
  'Администратор',
  'admin',
  true
FROM (SELECT id FROM organizations WHERE slug = 'mingg-school') org,
     (SELECT id FROM auth.users LIMIT 1) auth_users
ON CONFLICT (id) DO NOTHING;

-- Создаем тестового учителя
INSERT INTO profiles (organization_id, full_name, role, is_active)
SELECT 
  id,
  'Учитель Иван',
  'teacher',
  true
FROM organizations
WHERE slug = 'mingg-school'
ON CONFLICT (id) DO NOTHING;

-- Создаем группу класса
INSERT INTO groups (organization_id, name, description, created_by)
SELECT 
  org.id,
  '10А класс',
  'Ученики 10-го класса',
  prof.id
FROM organizations org, profiles prof
WHERE org.slug = 'mingg-school' AND prof.role = 'teacher' AND prof.organization_id = org.id
LIMIT 1
ON CONFLICT DO NOTHING;

-- Комментарий для админа:
-- ИНСТРУКЦИЯ: Для создания admin аккаунта выполните:
-- 1. Перейдите в Supabase Dashboard → Authentication → Users
-- 2. Нажмите "Add user"
-- 3. Email: admin@exam-platform.local (или любой другой)
-- 4. Password: [любой пароль]
-- 5. Скопируйте UUID пользователя
-- 6. Выполните SQL:
--    INSERT INTO profiles (id, organization_id, full_name, role, is_active)
--    VALUES ('[UUID]', (SELECT id FROM organizations WHERE slug = 'mingg-school'), 'Admin', 'admin', true);
