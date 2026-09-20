import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeShareAdmin } from '@/lib/sharing/authorize'
import { createClient } from '@/lib/supabase/server'

type Params = { params: Promise<{ id: string }> }

// GET/PUT — рубильник "разрешено ли ученику делиться" + дефолт срока
// действия гранта в днях, плюс сам whitelist получателей (для одного экрана
// администрирования, components/teacher/StudentSharePermissionsClient.tsx).
export async function GET(_request: NextRequest, { params }: Params) {
  const { id: studentId } = await params
  const auth = await authorizeShareAdmin(studentId)
  if ('error' in auth) return auth.error
  const { admin, orgId } = auth

  const [{ data: settings }, { data: recipients }, { data: orgTeachers }] = await Promise.all([
    admin
      .from('student_share_settings')
      .select('enabled, default_ttl_days')
      .eq('student_id', studentId)
      .maybeSingle(),
    admin
      .from('student_share_recipients')
      .select('teacher_id, profiles!teacher_id(full_name)')
      .eq('student_id', studentId),
    admin
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'teacher')
      .eq('organization_id', orgId)
      .order('full_name'),
  ])

  return NextResponse.json({
    enabled: settings?.enabled ?? false,
    default_ttl_days: settings?.default_ttl_days ?? 14,
    recipients: (recipients ?? []).map(r => ({
      teacher_id: r.teacher_id,
      full_name: (r.profiles as unknown as { full_name: string } | null)?.full_name ?? '—',
    })),
    org_teachers: orgTeachers ?? [],
  })
}

const putSchema = z.object({
  enabled: z.boolean(),
  default_ttl_days: z.number().int().min(1).max(90).optional(),
})

export async function PUT(request: NextRequest, { params }: Params) {
  const { id: studentId } = await params
  const auth = await authorizeShareAdmin(studentId)
  if ('error' in auth) return auth.error
  const { admin } = auth

  const parsed = putSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const updatedBy = user?.id ?? null

  const { error } = await admin.from('student_share_settings').upsert({
    student_id: studentId,
    enabled: parsed.data.enabled,
    ...(parsed.data.default_ttl_days !== undefined ? { default_ttl_days: parsed.data.default_ttl_days } : {}),
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'student_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
