import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeShareAdmin } from '@/lib/sharing/authorize'
import { createClient } from '@/lib/supabase/server'

type Params = { params: Promise<{ id: string }> }

const bodySchema = z.object({ teacher_id: z.string().uuid() })

// POST — добавить учителя в whitelist получателей ученика.
export async function POST(request: NextRequest, { params }: Params) {
  const { id: studentId } = await params
  const auth = await authorizeShareAdmin(studentId)
  if ('error' in auth) return auth.error
  const { admin, orgId } = auth

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const { teacher_id: teacherId } = parsed.data

  // Получатель — тоже учитель этой организации, не любой uuid.
  const { data: teacher } = await admin
    .from('profiles').select('id, role, organization_id').eq('id', teacherId).single()
  if (!teacher || teacher.role !== 'teacher' || teacher.organization_id !== orgId) {
    return NextResponse.json({ error: 'Учитель не найден в этой организации' }, { status: 404 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { error } = await admin.from('student_share_recipients').upsert({
    student_id: studentId,
    teacher_id: teacherId,
    granted_by: user?.id ?? null,
  }, { onConflict: 'student_id,teacher_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE — убрать учителя из whitelist.
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id: studentId } = await params
  const auth = await authorizeShareAdmin(studentId)
  if ('error' in auth) return auth.error
  const { admin } = auth

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { error } = await admin
    .from('student_share_recipients')
    .delete()
    .eq('student_id', studentId)
    .eq('teacher_id', parsed.data.teacher_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
