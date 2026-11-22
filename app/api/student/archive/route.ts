import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { archiveForStudent, canArchive, unarchiveForStudent } from '@/lib/assignments/archive'
import { getAppSettings } from '@/lib/settings/server'

const bodySchema = z.object({ assignment_id: z.string().uuid() })

// Допуск: сам ученик, назначение его — лично или через группу (как у
// «Поделиться», lib/sharing/authorize.ts). Роль проверяем явно: итог пишется
// service-role клиентом, и без проверки учитель создал бы строку итога себе.
async function authorize(assignmentId: string) {
  const supabase = await createClient()
  const { data: { user } } = await getAuthUser(supabase)
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'student') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const admin = createAdminClient()
  const { data: assignment } = await admin
    .from('assignments')
    .select('id, student_id, group_id, starts_at, created_at')
    .eq('id', assignmentId)
    .single()
  if (!assignment) return { error: NextResponse.json({ error: 'Назначение не найдено' }, { status: 404 }) }

  let owns = assignment.student_id === user.id
  if (!owns && assignment.group_id) {
    const { data: membership } = await admin
      .from('group_members')
      .select('user_id')
      .eq('group_id', assignment.group_id)
      .eq('user_id', user.id)
      .maybeSingle()
    owns = !!membership
  }
  if (!owns) return { error: NextResponse.json({ error: 'Это не ваше задание' }, { status: 403 }) }

  return { admin, studentId: user.id, assignment }
}

// POST { assignment_id } — убрать в архив. Только назначения старше
// archive_after_days дней (настройка системы): назначение закрывается, итог
// пишется в БД.
export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'assignment_id обязателен' }, { status: 400 })

  const auth = await authorize(parsed.data.assignment_id)
  if ('error' in auth) return auth.error
  const { admin, studentId, assignment } = auth

  const { archive_after_days: archiveAfterDays } = await getAppSettings()
  if (!canArchive(assignment, archiveAfterDays)) {
    return NextResponse.json(
      { error: `В архив можно убрать только задание, выданное больше ${archiveAfterDays} дней назад` },
      { status: 409 }
    )
  }

  const res = await archiveForStudent(admin, { assignmentId: assignment.id, studentId })
  if (!res) return NextResponse.json({ error: 'Не удалось убрать в архив' }, { status: 500 })

  return NextResponse.json({
    ok: true,
    finalized_attempt: res.finalizedAttemptId != null,
    final_score: res.finalScore,
    max_score: res.maxScore,
  })
}

// DELETE ?assignment_id= — вернуть из архива. Закрытие пересчитывается по
// попыткам: если они остались, задание снова можно решать.
export async function DELETE(request: NextRequest) {
  const parsed = bodySchema.safeParse({ assignment_id: request.nextUrl.searchParams.get('assignment_id') })
  if (!parsed.success) return NextResponse.json({ error: 'assignment_id обязателен' }, { status: 400 })

  const auth = await authorize(parsed.data.assignment_id)
  if ('error' in auth) return auth.error

  const ok = await unarchiveForStudent(auth.admin, { assignmentId: auth.assignment.id, studentId: auth.studentId })
  if (!ok) return NextResponse.json({ error: 'Не удалось вернуть из архива' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
