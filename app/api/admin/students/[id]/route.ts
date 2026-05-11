import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

async function verifyTeacher() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) return null
  return profile
}

// PATCH /api/admin/students/[id]  — update student info OR deactivate
const patchSchema = z.object({
  action: z.literal('deactivate').optional(),
  full_name: z.string().min(2).optional(),
  grade: z.string().nullable().optional(),
  email: z.string().includes('@').optional(),
  password: z.string().min(6).optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const profile = await verifyTeacher()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: student } = await admin
    .from('profiles').select('id, organization_id, role').eq('id', id).single()

  if (!student || student.organization_id !== profile.organization_id || student.role !== 'student') {
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

  const { full_name, grade, email, password } = parsed.data

  if (full_name !== undefined || grade !== undefined) {
    const update: { full_name?: string; grade?: string | null } = {}
    if (full_name !== undefined) update.full_name = full_name
    if (grade !== undefined) update.grade = grade
    const { error } = await admin.from('profiles').update(update).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (email || password) {
    const authUpdate: Record<string, string> = {}
    if (email) authUpdate.email = email
    if (password) authUpdate.password = password
    const { error } = await admin.auth.admin.updateUserById(id, authUpdate)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
  const profile = await verifyTeacher()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: student } = await admin
    .from('profiles').select('id, organization_id, role').eq('id', id).single()

  if (!student || student.organization_id !== profile.organization_id || student.role !== 'student') {
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
