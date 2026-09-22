import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeStudentShare } from '@/lib/sharing/authorize'

// GET ?assignment_id=... — активные гранты ученика по этому назначению (кому
// уже расшарено, для отображения "до {дата}" и кнопки "Отозвать").
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ shares: [] }, { status: 401 })

  const assignmentId = request.nextUrl.searchParams.get('assignment_id')
  if (!assignmentId) return NextResponse.json({ error: 'assignment_id обязателен' }, { status: 400 })

  const { data: shares } = await supabase
    .from('assignment_shares')
    .select('id, teacher_id, expires_at, revoked_at, profiles!teacher_id(full_name)')
    .eq('assignment_id', assignmentId)
    .eq('student_id', user.id)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())

  return NextResponse.json({
    shares: (shares ?? []).map(s => ({
      id: s.id,
      teacher_id: s.teacher_id,
      teacher_name: (s.profiles as unknown as { full_name: string } | null)?.full_name ?? '—',
      expires_at: s.expires_at,
    })),
  })
}

const postSchema = z.object({
  assignment_id: z.string().uuid(),
  teacher_id: z.string().uuid(),
})

// POST — расшарить сданную работу учителю из whitelist. Повторный вызов на
// ту же пару (assignment, teacher) продлевает существующий грант (upsert),
// не плодит дубли — см. unique(assignment_id, teacher_id) в 087.
export async function POST(request: NextRequest) {
  const parsed = postSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }
  const { assignment_id: assignmentId, teacher_id: teacherId } = parsed.data

  const auth = await authorizeStudentShare(assignmentId, teacherId)
  if ('error' in auth) return auth.error
  const { admin, studentId, ttlDays } = auth

  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString()

  const { data: share, error } = await admin
    .from('assignment_shares')
    .upsert({
      assignment_id: assignmentId,
      student_id: studentId,
      teacher_id: teacherId,
      granted_by: studentId,
      expires_at: expiresAt,
      revoked_at: null,
    }, { onConflict: 'assignment_id,teacher_id' })
    .select('id, expires_at')
    .single()

  if (error || !share) return NextResponse.json({ error: error?.message ?? 'Не удалось поделиться' }, { status: 500 })
  return NextResponse.json({ id: share.id, expires_at: share.expires_at })
}

const deleteSchema = z.object({ id: z.string().uuid() })

// DELETE — отозвать свой грант (soft: revoked_at, история сохраняется).
export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  // Записывать может только service role (087: "ashares: write service role
  // only"), поэтому владение проверяем явно здесь, читая обычным клиентом
  // (RLS "ashares: student reads own" гарантирует, что чужой грант вернёт 0
  // строк, а не подставную "не найдено" — прочитать чужую строку по id ученик
  // и так не может).
  const { data: shareRow } = await supabase
    .from('assignment_shares')
    .select('id, student_id')
    .eq('id', parsed.data.id)
    .single()
  if (!shareRow || shareRow.student_id !== user.id) {
    return NextResponse.json({ error: 'Грант не найден' }, { status: 404 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('assignment_shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', parsed.data.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
