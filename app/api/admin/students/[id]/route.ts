import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { zUuid } from '@/lib/uuid'
import { requireAdmin } from '@/lib/auth/authorize'

// Управление учениками (создание/правка/удаление/переназначение учителю) —
// только admin. Учитель видит своих учеников read-only.

// PATCH /api/admin/students/[id]  — update student info, reassign teacher OR deactivate
const patchSchema = z.object({
  action: z.literal('deactivate').optional(),
  full_name: z.string().min(2).optional(),
  grade: z.string().nullable().optional(),
  email: z.string().includes('@').optional(),
  password: z.string().min(6).optional(),
  // Полный набор прикреплённых учителей (M:N teacher_students). Если передан —
  // заменяет текущий набор для этого ученика (можно закрепить за несколькими).
  teacher_ids: z.array(zUuid()).optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { admin, orgId, userId } = auth

  const body = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
  }

  const { data: student } = await admin
    .from('profiles').select('id, organization_id, role').eq('id', id).single()

  if (!student || student.organization_id !== orgId || student.role !== 'student') {
    return NextResponse.json({ error: 'Student not found' }, { status: 404 })
  }

  // Deactivate action: soft-delete (keep auth user + results, remove memberships/assignments)
  if (parsed.data.action === 'deactivate') {
    await admin.from('group_members').delete().eq('user_id', id)
    await admin.from('assignments').delete().eq('student_id', id)
    const { error } = await admin.from('profiles').update({ is_active: false, deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const { full_name, grade, email, password, teacher_ids } = parsed.data

  if (full_name !== undefined || grade !== undefined) {
    const update: { full_name?: string; grade?: string | null } = {}
    if (full_name !== undefined) update.full_name = full_name
    if (grade !== undefined) update.grade = grade
    const { error } = await admin.from('profiles').update(update).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Полный набор прикреплённых учителей (M:N): валидируем, затем приводим
  // teacher_students к переданному набору (добавляем недостающие, убираем лишние)
  if (teacher_ids !== undefined) {
    const unique = [...new Set(teacher_ids)]
    if (unique.length > 0) {
      const { data: valid } = await admin
        .from('profiles').select('id')
        .in('id', unique).eq('role', 'teacher').eq('organization_id', orgId)
      if ((valid?.length ?? 0) !== unique.length) {
        return NextResponse.json({ error: 'Один из учителей не найден в вашей организации' }, { status: 422 })
      }
    }
    // убрать связи, которых нет в новом наборе
    let del = admin.from('teacher_students').delete().eq('student_id', id)
    if (unique.length > 0) del = del.not('teacher_id', 'in', `(${unique.join(',')})`)
    const { error: delErr } = await del
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
    // добавить недостающие
    if (unique.length > 0) {
      const rows = unique.map(tid => ({ teacher_id: tid, student_id: id, assigned_by: userId }))
      const { error: insErr } = await admin
        .from('teacher_students').upsert(rows, { onConflict: 'teacher_id,student_id' })
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
    }
  }

  if (email || password) {
    const authUpdate: Record<string, string> = {}
    if (email) authUpdate.email = email
    if (password) authUpdate.password = password
    const { error } = await admin.auth.admin.updateUserById(id, authUpdate)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // profiles.email — копия auth-email (миграция 025), синхронизируем
    if (email) await admin.from('profiles').update({ email }).eq('id', id)
  }

  return NextResponse.json({ ok: true })
}

// DELETE /api/admin/students/[id]
// Hard delete: removes all student data including auth user
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { admin, orgId } = auth

  const { data: student } = await admin
    .from('profiles').select('id, organization_id, role').eq('id', id).single()

  if (!student || student.organization_id !== orgId || student.role !== 'student') {
    return NextResponse.json({ error: 'Student not found' }, { status: 404 })
  }

  // 1. RPC handles: attempts, assignments, group_members, soft-deletes profile
  const { error: rpcError } = await admin.rpc('delete_student_cascade', { target_student_id: id })
  if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 500 })

  // 2. Delete remaining rows that reference profiles.id
  await admin.from('solution_requests').delete().eq('student_id', id)
  await admin.from('student_final_results').delete().eq('student_id', id)

  // 3. Hard-delete the profile row itself
  const { error: profileError } = await admin.from('profiles').delete().eq('id', id)
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 })

  // 4. Delete the auth user (must be last)
  const { error: authError } = await admin.auth.admin.deleteUser(id)
  if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
