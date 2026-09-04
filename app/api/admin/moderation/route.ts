import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { zUuid } from '@/lib/uuid'
import { requireAdmin } from '@/lib/auth/authorize'

const decideSchema = z.object({
  user_id: zUuid(),
  action: z.enum(['approve', 'reject']),
  // Что назначаем при одобрении — админ выставляет роль и метаданные сам
  role: z.enum(['student', 'teacher', 'admin']).optional(),
  grade: z.string().trim().max(16).nullable().optional(),
  teacher_id: zUuid().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
})

// GET /api/admin/moderation — заявки, ожидающие подтверждения.
// Нужен и для счётчика-бейджа в навигации, поэтому отвечает быстро и коротко.
export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { admin, orgId } = auth

  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name, email, telegram_username, phone, pd_consent_at, created_at, moderation_status')
    .eq('moderation_status', 'pending')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ pending: data ?? [], count: (data ?? []).length, orgId })
}

// POST /api/admin/moderation — одобрить или отклонить заявку.
//
// При одобрении профиль получает роль и организацию админа: до этого момента
// у самостоятельно зарегистрировавшегося organization_id пуст, и он никуда не
// попадает (см. proxy.ts — pending редиректит на страницу ожидания).
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { admin, userId, orgId } = auth

  const parsed = decideSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const { user_id, action, role, grade, teacher_id, note } = parsed.data

  const { data: target } = await admin
    .from('profiles')
    .select('id, moderation_status, full_name')
    .eq('id', user_id)
    .maybeSingle()

  if (!target) return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })
  if (target.moderation_status !== 'pending') {
    return NextResponse.json({ error: 'Заявка уже обработана' }, { status: 409 })
  }

  if (action === 'reject') {
    const { error } = await admin
      .from('profiles')
      .update({
        moderation_status: 'rejected',
        moderation_note: note ?? null,
        moderated_by: userId,
        moderated_at: new Date().toISOString(),
        is_active: false,
      })
      .eq('id', user_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, status: 'rejected' })
  }

  const finalRole = role ?? 'student'
  const { error } = await admin
    .from('profiles')
    .update({
      moderation_status: 'approved',
      moderation_note: note ?? null,
      moderated_by: userId,
      moderated_at: new Date().toISOString(),
      role: finalRole,
      organization_id: orgId,
      grade: finalRole === 'student' ? (grade || null) : null,
      is_active: true,
      created_by: userId,
    })
    .eq('id', user_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Закрепление за учителем — та же связка M:N, что при заведении вручную
  if (finalRole === 'student' && teacher_id) {
    const { error: linkErr } = await admin
      .from('teacher_students')
      .upsert({ teacher_id, student_id: user_id }, { onConflict: 'teacher_id,student_id' })
    if (linkErr) {
      // Профиль уже одобрен — привязку можно поправить вручную, поэтому
      // не откатываем, но и не молчим
      return NextResponse.json({ ok: true, status: 'approved', warning: 'Не удалось закрепить за учителем' })
    }
  }

  return NextResponse.json({ ok: true, status: 'approved' })
}
