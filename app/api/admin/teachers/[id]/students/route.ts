import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { UUID_RE } from '@/lib/uuid'

// PATCH /api/admin/teachers/[id]/students
// Множественное закрепление/открепление учеников за учителем (profiles.created_by).
// Только admin. action='assign' → created_by=teacherId; 'unassign' → created_by=null
// (только у тех, кто сейчас закреплён именно за этим учителем — чужих не трогаем).
const schema = z.object({
  student_ids: z.array(z.string().regex(UUID_RE)).min(1, 'Выберите хотя бы одного ученика'),
  action: z.enum(['assign', 'unassign']),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: teacherId } = await params

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Доступно только администратору' }, { status: 403 })
  }
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'No organization' }, { status: 400 })
  }
  const orgId = profile.organization_id

  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  }
  const { student_ids, action } = parsed.data

  const admin = createAdminClient()

  // Учитель существует, роль teacher, та же организация
  const { data: teacher } = await admin
    .from('profiles').select('id, role, organization_id').eq('id', teacherId).single()
  if (!teacher || teacher.role !== 'teacher' || teacher.organization_id !== orgId) {
    return NextResponse.json({ error: 'Учитель не найден в вашей организации' }, { status: 404 })
  }

  // Оставляем только реальных учеников этой организации
  const { data: validStudents } = await admin
    .from('profiles')
    .select('id')
    .in('id', student_ids)
    .eq('role', 'student')
    .eq('organization_id', orgId)
  const ids = (validStudents ?? []).map(s => s.id)
  if (ids.length === 0) {
    return NextResponse.json({ error: 'Ученики не найдены в вашей организации' }, { status: 422 })
  }

  // Прикрепление аддитивное (M:N через teacher_students): assign не снимает
  // ученика с других учителей, unassign убирает связь только с этим учителем.
  if (action === 'assign') {
    const rows = ids.map(sid => ({ teacher_id: teacherId, student_id: sid, assigned_by: user.id }))
    const { error } = await admin.from('teacher_students').upsert(rows, { onConflict: 'teacher_id,student_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await admin
      .from('teacher_students').delete().eq('teacher_id', teacherId).in('student_id', ids)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, affected: ids.length })
}
