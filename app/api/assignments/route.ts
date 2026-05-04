import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  test_id: z.string().uuid(),
  target_type: z.enum(['group', 'student']),
  group_id: z.string().uuid().optional().nullable(),
  student_id: z.string().uuid().optional().nullable(),
  starts_at: z.string().optional().nullable(),
  ends_at: z.string().optional().nullable(),
  max_attempts: z.number().min(1).default(1),
  preserve_answers: z.boolean().default(false),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()

  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!profile.organization_id) {
    return NextResponse.json({ error: 'No organization' }, { status: 400 })
  }

  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  const { test_id, target_type, group_id, student_id, starts_at, ends_at, max_attempts, preserve_answers } = parsed.data

  if (target_type === 'group' && !group_id) {
    return NextResponse.json({ error: 'Выберите группу' }, { status: 400 })
  }
  if (target_type === 'student' && !student_id) {
    return NextResponse.json({ error: 'Выберите ученика' }, { status: 400 })
  }

  // Get the version ID for this test
  const admin = createAdminClient()
  const { data: test } = await admin
    .from('tests')
    .select('current_published_version_id, organization_id')
    .eq('id', test_id)
    .single()

  if (!test || test.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: 'Test not found' }, { status: 404 })
  }

  if (!test.current_published_version_id) {
    return NextResponse.json({ error: 'Тест не опубликован' }, { status: 400 })
  }

  const { data: assignment, error } = await admin.from('assignments').insert({
    test_version_id: test.current_published_version_id,
    organization_id: profile.organization_id,
    group_id: target_type === 'group' ? group_id : null,
    student_id: target_type === 'student' ? student_id : null,
    starts_at: starts_at || null,
    ends_at: ends_at || null,
    max_attempts,
    preserve_answers,
    created_by: user.id,
  }).select('id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: assignment.id }, { status: 201 })
}
