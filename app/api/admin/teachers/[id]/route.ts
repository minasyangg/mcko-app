import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/authorize'
import type { createAdminClient } from '@/lib/supabase/admin'
import { updateLoginCredentials } from '@/lib/admin/user-account'
import {
  findTelegramNickHolder, isTelegramNickTakenError, telegramNickTakenForAdmin,
} from '@/lib/notifications/telegram-username'

// Карточка учителя в админ-панели: правка, деактивация/возврат, удаление —
// только admin. Пара к /api/admin/students/[id]; создание — /api/admin/create-teacher,
// закрепление учеников — /api/admin/teachers/[id]/students.

// Бан в Supabase Auth на ~100 лет: is_active сам по себе вход не закрывает
// (proxy.ts его не проверяет), а деактивированный учитель входить не должен
const BAN_FOREVER = '876000h'

const patchSchema = z.object({
  action: z.enum(['deactivate', 'activate']).optional(),
  full_name: z.string().min(2).optional(),
  email: z.string().includes('@').optional(),
  password: z.string().min(6).optional(),
  // '' = отвязать ник; иначе валидный ник Telegram
  telegram_username: z.string().regex(/^([A-Za-z0-9_]{5,32})?$/, 'Ник Telegram — 5–32 символа: латиница, цифры, _').optional(),
})

async function findTeacher(admin: ReturnType<typeof createAdminClient>, id: string, orgId: string) {
  const { data } = await admin
    .from('profiles').select('id, organization_id, role, full_name, telegram_username').eq('id', id).single()
  return data && data.organization_id === orgId && data.role === 'teacher' ? data : null
}

// PATCH /api/admin/teachers/[id] — правка ФИО/Telegram/email/пароля или деактивация/возврат
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { admin, orgId } = auth

  const body = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
  }

  const teacher = await findTeacher(admin, id, orgId)
  if (!teacher) return NextResponse.json({ error: 'Учитель не найден' }, { status: 404 })

  // Деактивация обратима: тесты, группы, программы и закреплённые ученики
  // остаются за учителем, закрывается только вход (бан в Auth)
  if (parsed.data.action) {
    const active = parsed.data.action === 'activate'
    const { error: banError } = await admin.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : BAN_FOREVER })
    if (banError) return NextResponse.json({ error: banError.message }, { status: 500 })
    const { error } = await admin.from('profiles').update({ is_active: active }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const { full_name, email, password, telegram_username } = parsed.data
  const update: { full_name?: string; telegram_username?: string | null; telegram_chat_id?: null } = {}
  if (full_name !== undefined) update.full_name = full_name
  // смена ника админом сбрасывает привязку chat_id — учитель сам жмёт /start
  if (telegram_username !== undefined) {
    const uname = telegram_username || null
    if (uname !== teacher.telegram_username) {
      if (uname) {
        // Ник — ключ привязки бота, у него один владелец (lib/notifications/telegram-username.ts)
        const holder = await findTelegramNickHolder(admin, uname, id)
        if (holder) return NextResponse.json({ error: telegramNickTakenForAdmin(uname, holder, orgId) }, { status: 409 })
      }
      update.telegram_username = uname
      update.telegram_chat_id = null
    }
  }
  if (Object.keys(update).length > 0) {
    const { error } = await admin.from('profiles').update(update).eq('id', id)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: isTelegramNickTakenError(error) ? 409 : 500 })
    }
  }

  const credentialsError = await updateLoginCredentials(admin, id, { email, password })
  if (credentialsError) return credentialsError

  return NextResponse.json({ ok: true })
}

// DELETE /api/admin/teachers/[id] — удалить навсегда. Только учителя без
// материалов: тесты, назначения, группы, программы, журналы и заведённые им
// ученики ссылаются на него без каскада (удаление упало бы на FK, а каскад
// стёр бы результаты учеников), доски Doska (общая база, owner_id ON DELETE
// CASCADE) удалились бы молча. Такого учителя — деактивировать.
function countTeacherContent(admin: ReturnType<typeof createAdminClient>, id: string) {
  const head = { count: 'exact' as const, head: true }
  return Promise.all([
    { label: 'тесты', q: admin.from('tests').select('*', head).eq('created_by', id) },
    { label: 'назначения', q: admin.from('assignments').select('*', head).eq('created_by', id) },
    { label: 'группы', q: admin.from('groups').select('*', head).eq('created_by', id) },
    { label: 'программы', q: admin.from('roadmaps').select('*', head).eq('created_by', id) },
    { label: 'журналы посещаемости', q: admin.from('attendance_journals').select('*', head).eq('created_by', id) },
    { label: 'заведённые им ученики', q: admin.from('profiles').select('*', head).eq('created_by', id) },
    { label: 'доски Doska', q: admin.from('doska_boards').select('*', head).eq('owner_id', id) },
  ].map(async ({ label, q }) => {
    const { count, error } = await q
    return { label, count: error ? -1 : count ?? 0 }
  }))
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { admin, orgId } = auth

  const teacher = await findTeacher(admin, id, orgId)
  if (!teacher) return NextResponse.json({ error: 'Учитель не найден' }, { status: 404 })

  const counts = await countTeacherContent(admin, id)
  if (counts.some((c) => c.count < 0)) {
    return NextResponse.json({ error: 'Не удалось проверить материалы учителя — удаление отменено' }, { status: 500 })
  }
  const owned = counts.filter((c) => c.count > 0)
  if (owned.length > 0) {
    return NextResponse.json({
      error: `У учителя есть ${owned.map((c) => `${c.label} (${c.count})`).join(', ')}. Удалить можно только учителя без материалов — деактивируйте его.`,
    }, { status: 409 })
  }

  // Каскадом уходят закрепления учеников, права на книги, гранты шаринга
  const { error: profileError } = await admin.from('profiles').delete().eq('id', id)
  if (profileError) {
    // FK без каскада, не попавший в проверку выше (журнал аудита и т.п.)
    if (profileError.code === '23503') {
      return NextResponse.json({ error: 'На учителя ссылаются другие записи — деактивируйте его вместо удаления' }, { status: 409 })
    }
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  // Auth-пользователь — последним (как у учеников)
  const { error: authError } = await admin.auth.admin.deleteUser(id)
  if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
