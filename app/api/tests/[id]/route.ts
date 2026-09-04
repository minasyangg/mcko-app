import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { analyzeTestUsage, deleteTest } from '@/lib/tests/delete'

// PATCH /api/tests/[id] — update test metadata
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: testId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: test } = await supabase
    .from('tests').select('id, organization_id, created_by').eq('id', testId).single()
  if (!test || test.organization_id !== profile.organization_id) {
    return Response.json({ error: 'Test not found' }, { status: 404 })
  }

  // Owner-чек: учитель правит только свои тесты, admin — любые в организации
  if (profile.role !== 'admin' && test.created_by !== user.id) {
    return Response.json({ error: 'Редактировать может только создатель теста или администратор' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))

  type TestUpdate = {
    title?: string
    subject?: string | null
    grade?: string | null
    exam_type?: string | null
    description?: string | null
    scoring_rule_id?: string | null
  }
  const update: TestUpdate = {}

  for (const key of ['subject', 'grade', 'exam_type', 'description'] as const) {
    if (key in body) update[key] = body[key] ? String(body[key]) : null
  }
  if ('title' in body && body.title) update.title = String(body.title)
  if ('scoring_rule_id' in body) update.scoring_rule_id = body.scoring_rule_id || null

  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'No fields to update' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('tests').update(update).eq('id', testId)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: testId } = await params
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile || !['teacher', 'admin'].includes(profile.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Verify the test belongs to the teacher's organization
    const { data: test, error: testError } = await supabase
      .from('tests')
      .select('id, organization_id, created_by')
      .eq('id', testId)
      .single()

    if (testError || !test) {
      return Response.json({ error: 'Test not found' }, { status: 404 })
    }

    if (test.organization_id !== profile.organization_id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Owner-чек: учитель удаляет только свои тесты, admin — любые в организации
    if (profile.role !== 'admin' && test.created_by !== user.id) {
      return Response.json({ error: 'Удалять может только создатель теста или администратор' }, { status: 403 })
    }

    const admin = createAdminClient()

    // Способ удаления решает analyzeTestUsage: тест, который никто не решал,
    // стирается физически; тест с попытками только помечается скрытым, иначе
    // вместе с ним пропали бы результаты учеников (student_final_results
    // каскадится от test_versions, а прежний код здесь ещё и вручную удалял
    // attempts вместе с ответами).
    const [usage] = await analyzeTestUsage(admin, [testId])
    const mode = usage?.mode ?? 'hard'

    const res = await deleteTest(admin, testId, mode)
    if (!res.ok) {
      return Response.json({ error: res.error }, { status: 500 })
    }

    return Response.json({ success: true, mode })
  } catch (err) {
    console.error('[DELETE /api/tests/[id]]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
