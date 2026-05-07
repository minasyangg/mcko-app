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

// PATCH /api/admin/students/[id]  — update student info
const patchSchema = z.object({
  full_name: z.string().min(2).optional(),
  grade: z.string().nullable().optional(),
  email: z.string().email().optional(),
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

  // Verify the student belongs to same org
  const { data: student } = await admin
    .from('profiles').select('id, organization_id, role').eq('id', id).single()

  if (!student || student.organization_id !== profile.organization_id || student.role !== 'student') {
    return NextResponse.json({ error: 'Student not found' }, { status: 404 })
  }

  const { full_name, grade, email, password } = parsed.data

  // Update profile fields
  if (full_name !== undefined || grade !== undefined) {
    const update: { full_name?: string; grade?: string | null } = {}
    if (full_name !== undefined) update.full_name = full_name
    if (grade !== undefined) update.grade = grade
    const { error } = await admin.from('profiles').update(update).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Update email / password via Auth admin
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
// Soft-delete: sets is_active=false, removes assignments & group memberships
// Preserves attempts/results for analytics
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

  // 1. Delete group memberships
  await admin.from('group_members').delete().eq('user_id', id)

  // 2. Delete assignments for this student (soft-delete approach: remove future assignments only)
  await admin.from('assignments').delete().eq('student_id', id)

  // 3. Soft-delete the profile (keeps auth user + historical results)
  const { error } = await admin.from('profiles').update({ is_active: false }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
