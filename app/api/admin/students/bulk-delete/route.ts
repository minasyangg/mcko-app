import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { zUuid } from '@/lib/uuid'
import { requireAdmin } from '@/lib/auth/authorize'

const schema = z.object({
  student_ids: z.array(zUuid()).min(1).max(100),
  /** true — только посчитать связи, ничего не удаляя */
  dry_run: z.boolean().optional(),
})

// POST /api/admin/students/bulk-delete — массовое удаление учеников.
//
// Удаление «мягкое» по той же причине, что и у тестов: попытки и итоги —
// это статистика, которую нельзя терять. delete_student_cascade (существующая
// функция БД) перед удалением попыток переносит итоговый балл в
// student_final_results, снимает ученика с назначений и групп и помечает
// профиль deleted_at.
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { admin, orgId } = auth

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const { student_ids, dry_run } = parsed.data

  // Все удаляемые должны быть учениками своей организации: admin-клиент
  // работает в обход RLS, поэтому проверяем явно
  const { data: students } = await admin
    .from('profiles')
    .select('id, full_name, role, organization_id')
    .in('id', student_ids)
    .is('deleted_at', null)

  const found = students ?? []
  if (found.length !== student_ids.length) {
    return NextResponse.json({ error: 'Часть учеников не найдена' }, { status: 404 })
  }
  const alien = found.filter(s => s.role !== 'student' || s.organization_id !== orgId)
  if (alien.length > 0) {
    return NextResponse.json({ error: 'В списке есть не ваши ученики' }, { status: 403 })
  }

  // Что зацеплено — показываем до подтверждения
  const [{ data: attempts }, { data: asgns }, { data: members }] = await Promise.all([
    admin.from('attempts').select('student_id').in('student_id', student_ids),
    admin.from('assignments').select('student_id').in('student_id', student_ids),
    admin.from('group_members').select('user_id').in('user_id', student_ids),
  ])

  // student_id у назначений nullable (групповые назначения) — пустые пропускаем
  const countBy = (rows: Record<string, string | null>[] | null, key: string) => {
    const m = new Map<string, number>()
    for (const r of rows ?? []) {
      const id = r[key]
      if (id) m.set(id, (m.get(id) ?? 0) + 1)
    }
    return m
  }
  const attemptsBy = countBy(attempts, 'student_id')
  const asgnBy = countBy(asgns, 'student_id')
  const groupsBy = countBy(members, 'user_id')

  const usage = found.map(s => ({
    student_id: s.id,
    full_name: s.full_name,
    attempts: attemptsBy.get(s.id) ?? 0,
    assignments: asgnBy.get(s.id) ?? 0,
    groups: groupsBy.get(s.id) ?? 0,
  }))

  if (dry_run) {
    return NextResponse.json({
      usage,
      total_attempts: usage.reduce((a, u) => a + u.attempts, 0),
      with_data: usage.filter(u => u.attempts > 0).length,
    })
  }

  const results: { student_id: string; full_name: string; ok: boolean; error?: string }[] = []
  for (const s of found) {
    const { error } = await admin.rpc('delete_student_cascade', { target_student_id: s.id })
    results.push({
      student_id: s.id,
      full_name: s.full_name,
      ok: !error,
      ...(error ? { error: error.message } : {}),
    })
  }

  const failed = results.filter(r => !r.ok)
  return NextResponse.json({
    ok: failed.length === 0,
    deleted: results.filter(r => r.ok).length,
    failed,
  })
}
