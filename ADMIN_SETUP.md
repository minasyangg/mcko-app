# 🔐 Инструкция: Как создать Admin аккаунт

## Шаг 1: Создать пользователя в Supabase Auth

1. Перейдите в **Supabase Dashboard**: https://supabase.com/dashboard
2. Выберите ваш проект `zcfgyfugxtbnqrcjfifo`
3. В левом меню выберите **Authentication** → **Users**
4. Нажмите кнопку **"Add user"** или **"Create new user"**
5. Заполните:
   - **Email**: `admin@exam-platform.local` (или любой другой)
   - **Password**: [придумайте надежный пароль]
6. Нажмите **Create user**

## Шаг 2: Получить UUID пользователя

1. После создания пользователя вы увидите таблицу с пользователем
2. Скопируйте **User ID** (это UUID вида `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

## Шаг 3: Добавить пользователя как Admin

1. В Supabase Dashboard перейдите в **SQL Editor**
2. Выполните следующий SQL запрос (вставьте скопированный UUID):

```sql
-- Убедитесь, что организация существует
INSERT INTO organizations (name, slug, settings)
VALUES ('MinGG School', 'mingg-school', '{"timezone": "Europe/Moscow"}')
ON CONFLICT (slug) DO NOTHING;

-- Добавьте пользователя как admin
INSERT INTO profiles (id, organization_id, full_name, role, is_active)
VALUES (
  '[СКОПИРОВАННЫЙ_UUID_ЗДЕСЬ]',
  (SELECT id FROM organizations WHERE slug = 'mingg-school'),
  'Администратор',
  'admin',
  true
);
```

3. Нажмите **Run** или **Ctrl+Enter**

## Шаг 4: Проверить, что всё работает

1. Откройте https://mcko-app.vercel.app
2. Нажмите **"Вход"**
3. Введите email и пароль, которые вы создали
4. Вы должны попасть в админ-панель

## ✅ Готово!

Теперь у вас есть admin аккаунт для управления платформой.

---

## 📝 Примечания

- **Email для теста**: `admin@exam-platform.local`
- **UUID пользователя**: Видно в Supabase Dashboard → Users
- **Организация**: Автоматически создается при выполнении SQL
- **Role**: Роль `admin` дает полный доступ к системе

## 🔑 Альтернативный способ: Через CLI

Если вы предпочитаете командную строку:

```bash
cd d:\www\mcko-app
supabase db push  # применить все миграции
supabase seed     # выполнить seed.sql
```

После этого выполните SQL запрос из Шага 3.
