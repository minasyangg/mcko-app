import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { closeAssignment, reopenAssignment } from '@/lib/assignments/close'
import { notifyAttemptFinalized } from '@/lib/notifications/send'

// Скоуп тот же, что у DELETE /api/assignments/[id]: учитель распоряжается
// своими назначениями, админ — любыми в организации. Мониторинг показывает
// учителю и чужие назначения его учеников (RLS из 018 разрешает читать попытки
// своих учеников), поэтому владение проверяем явно, а не полагаемся на видимость.
async function authorize(assignmentId: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const admin = createAdminClient()
  const { data: assignment } = await admin
    .from('assignments')
    .select('id, organization_id, created_by, student_id, group_id')
    .eq('id', assignmentId)
    .single()

  if (!assignment || assignment.organization_id !== profile.organization_id) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }
  if (profile.role !== 'admin' && assignment.created_by !== user.id) {
    return {
      error: NextResponse.json(
        { error: 'Завершить может только создатель назначения или администратор' },
        { status: 403 }
      ),
    }
  }

  return { admin, userId: user.id, assignment }
}

// POST /api/assignments/[id]/close — принудительно завершить назначение, даже
// если у учеников остались попытки. Body: { student_id?: string } — с ним
// закрывается только этот ученик, без него всё назначение (все адресаты).
// Активные попытки при этом сдаются и авто-проверяются, не начатые помечаются
// истёкшими, итог по каждому ученику пишется в student_final_results — чтобы
// результат попал в статистику.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: assignmentId } = await params

  const auth = await authorize(assignmentId)
  if ('error' in auth) return auth.error
  const { admin, userId } = auth

  const body = await request.json().catch(() => ({} as { student_id?: string }))
  const studentId = typeof body?.student_id === 'string' ? body.student_id : undefined

  const result = await closeAssignment(admin, { assignmentId, closedBy: userId, studentId })
  if (!result) {
    return NextResponse.json(
      { error: 'Ученик не относится к этому назначению' },
      { status: 400 }
    )
  }

  // Уведомления — после ответа и последовательно (лимиты Bot API).
  // Ученикам результат уходит, учителю — нет: он сам инициировал завершение и
  // видит сводку в ответе, а на группе это была бы пачка из десятков сообщений.
  after(async () => {
    for (const id of result.finalizedAttemptIds) {
      await notifyAttemptFinalized(id, { teacherNotice: false })
    }
  })

  return NextResponse.json({
    ok: true,
    scope: studentId ? 'student' : 'assignment',
    closed_students: result.closedStudents,
    finished_attempts: result.finalizedAttemptIds.length,
    expired: result.expired,
  })
}

// DELETE /api/assignments/[id]/close — снять принудительное завершение.
// Потраченные попытки не возвращаются: если лимит исчерпан или набран полный
// балл, назначение останется закрытым уже по расчётной причине.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: assignmentId } = await params

  const auth = await authorize(assignmentId)
  if ('error' in auth) return auth.error
  const { admin } = auth

  const studentId = request.nextUrl.searchParams.get('student_id') ?? undefined

  const result = await reopenAssignment(admin, { assignmentId, studentId })

  return NextResponse.json({
    ok: true,
    scope: studentId ? 'student' : 'assignment',
    reopened_students: result.reopenedStudents,
  })
}
