import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { zUuid } from '@/lib/uuid'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { analyzeTestUsage, deleteTest } from '@/lib/tests/delete'

const schema = z.object({
  test_ids: z.array(zUuid()).min(1).max(100),
  /** true — только посчитать связи и вернуть предупреждение, ничего не удаляя */
  dry_run: z.boolean().optional(),
})

// Кто вправе удалять: админ — любой тест своей организации, учитель — только
// свои. Проверяем явно, потому что дальше работаем admin-клиентом в обход RLS.
async function authorize(testIds: string[]) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const admin = createAdminClient()
  const { data: tests } = await admin
    .from('tests').select('id, created_by, organization_id').in('id', testIds)

  const found = tests ?? []
  if (found.length !== testIds.length) {
    return { error: NextResponse.json({ error: 'Часть тестов не найдена' }, { status: 404 }) }
  }
  const alien = found.filter(t =>
    t.organization_id !== profile.organization_id ||
    (profile.role !== 'admin' && t.created_by !== user.id))
  if (alien.length > 0) {
    return { error: NextResponse.json({ error: 'Есть тесты, которые вам не принадлежат' }, { status: 403 }) }
  }

  return { admin, userId: user.id }
}

// POST /api/tests/bulk-delete — массовое удаление тестов/ДЗ.
//
// dry_run: true возвращает разбор связей — сколько попыток, назначений и
// привязок к программам зацеплено и что именно произойдёт с каждым тестом.
// Интерфейс показывает это до подтверждения.
export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const { test_ids, dry_run } = parsed.data

  const auth = await authorize(test_ids)
  if ('error' in auth) return auth.error
  const { admin } = auth

  const usage = await analyzeTestUsage(admin, test_ids)

  if (dry_run) {
    return NextResponse.json({
      usage,
      hard: usage.filter(u => u.mode === 'hard').length,
      soft: usage.filter(u => u.mode === 'soft').length,
    })
  }

  const results: { test_id: string; title: string; mode: string; ok: boolean; error?: string }[] = []
  for (const u of usage) {
    const res = await deleteTest(admin, u.test_id, u.mode)
    results.push({
      test_id: u.test_id,
      title: u.title,
      mode: u.mode,
      ok: res.ok,
      ...(res.ok ? {} : { error: res.error }),
    })
  }

  const failed = results.filter(r => !r.ok)
  return NextResponse.json({
    ok: failed.length === 0,
    deleted: results.filter(r => r.ok && r.mode === 'hard').length,
    hidden: results.filter(r => r.ok && r.mode === 'soft').length,
    failed,
  })
}
