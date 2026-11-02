import { NextResponse } from 'next/server'
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

// Смена email/пароля учётки админом — общая для карточек учеников и учителей
// (/api/admin/students/[id], /api/admin/teachers/[id]). Возвращает ответ с
// ошибкой или null, если всё прошло.
export async function updateLoginCredentials(
  admin: AdminClient,
  id: string,
  { email, password }: { email?: string; password?: string },
): Promise<NextResponse | null> {
  if (!email && !password) return null
  const authUpdate: Record<string, string> = {}
  if (email) authUpdate.email = email
  if (password) authUpdate.password = password
  const { error } = await admin.auth.admin.updateUserById(id, authUpdate)
  if (error) {
    // auth.users.email уникален (users_email_partial_key) — живой
    // инцидент: браузерный autofill подставил в поле "Новый email" чужой
    // сохранённый адрес уже после рендера формы (клиентский input не
    // видел этого в своём React state), сервер упал на голом postgres
    // "duplicate key value violates unique constraint" — учителю это
    // ничего не говорило. Клиент дополнительно защищён autoComplete="off"
    // на этом поле, но сервер всё равно даёт понятный текст на случай
    // реального совпадения (два разных пользователя, один email по ошибке).
    const isDuplicateEmail = email && /duplicate key.*email|users_email_partial_key/i.test(error.message)
    return NextResponse.json(
      { error: isDuplicateEmail ? `Email ${email} уже используется другим аккаунтом` : error.message },
      { status: isDuplicateEmail ? 409 : 500 }
    )
  }
  // profiles.email — копия auth-email (миграция 025), синхронизируем
  if (email) await admin.from('profiles').update({ email }).eq('id', id)
  return null
}
