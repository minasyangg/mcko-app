import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/authorize'

const schema = z.object({
  full_name: z.string().min(2, 'Минимум 2 символа'),
  email: z.string().email('Некорректный email'),
  password: z.string().min(6, 'Минимум 6 символов'),
  telegram_username: z.string().regex(/^[A-Za-z0-9_]{5,32}$/, 'Ник Telegram — 5–32 символа: латиница, цифры, _').optional(),
})

// POST /api/admin/create-teacher — создать пользователя с ролью teacher.
// Только admin. Триггер handle_new_user создаёт профиль (всегда student,
// миграция 022) — роль teacher и организацию проставляем здесь service role.
export async function POST(request: Request) {
  const auth = await requireAdmin('Создавать учителей может только администратор')
  if ('error' in auth) return auth.error
  const { admin: adminClient, orgId } = auth

  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  }
  const { full_name, email, password, telegram_username } = parsed.data

  const { data: authData, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role: 'teacher' },
  })

  if (createError) {
    if (createError.message.includes('already registered') || createError.message.includes('already been registered')) {
      return NextResponse.json({ error: 'Пользователь с таким email уже существует' }, { status: 409 })
    }
    return NextResponse.json({ error: createError.message }, { status: 500 })
  }

  // handle_new_user уже создал профиль; проставляем организацию и роль teacher
  const { error: updateError } = await adminClient
    .from('profiles')
    .update({
      organization_id: orgId,
      full_name,
      role: 'teacher',
      telegram_username: telegram_username || null,
    })
    .eq('id', authData.user.id)

  if (updateError) {
    console.error('Failed to update teacher profile:', updateError)
  }

  return NextResponse.json({ id: authData.user.id, email }, { status: 201 })
}
