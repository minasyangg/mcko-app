import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { zUuid } from '@/lib/uuid'
import { createClient } from '@/lib/supabase/server'

const schema = z.object({
  // Задачи, которые учитель собирается добавить (id в книге/библиотеке)
  problem_ids: z.array(zUuid()).min(1).max(300),
  // Куда добавляет — по версии теста определяем адресатов
  test_version_id: zUuid().optional(),
  // Либо адресаты заданы напрямую (карточки каталога знают выбранного ученика)
  student_ids: z.array(zUuid()).max(200).optional(),
})

export interface DuplicateHit {
  problem_id: string
  student_id: string
  student_name: string
  test_title: string
  assigned_at: string
}

// POST /api/assignments/duplicates — «эти задачи уже задавались?»
//
// Отвечает фактом, а не запретом: повторить задачу — законный приём, решение
// за учителем (по требованию пользователя запрет не вводим).
//
// Границы поиска (см. view assigned_problems, миграция 052): только ДЗ этого
// же учителя, только за 11 месяцев, только задачи со ссылкой на источник.
// Задания из PDF-импорта связи с источником не имеют и здесь не участвуют —
// поэтому пустой ответ НЕ доказывает, что задача не задавалась.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const { problem_ids, test_version_id, student_ids } = parsed.data

  // Определяем адресатов: либо переданы явно, либо выводим из назначений
  // целевого ДЗ (групповые раскрываются в участников).
  let students = student_ids ?? []
  if (students.length === 0 && test_version_id) {
    const { data: asgns } = await supabase
      .from('assignments')
      .select('student_id, group_id')
      .eq('test_version_id', test_version_id)

    const direct = (asgns ?? []).map(a => a.student_id).filter(Boolean) as string[]
    const groupIds = (asgns ?? []).map(a => a.group_id).filter(Boolean) as string[]

    let fromGroups: string[] = []
    if (groupIds.length > 0) {
      const { data: members } = await supabase
        .from('group_members').select('user_id').in('group_id', groupIds)
      fromGroups = (members ?? []).map(m => m.user_id)
    }
    students = [...new Set([...direct, ...fromGroups])]
  }

  // ДЗ ещё никому не назначено — сравнивать не с кем, это не ошибка
  if (students.length === 0) return NextResponse.json({ duplicates: [] })

  // teacher_id = сам пользователь: учитываем только собственные задания,
  // даже если с учеником занимается ещё кто-то (требование пользователя)
  const { data: rows, error } = await supabase
    .from('assigned_problems')
    .select('problem_id, student_id, test_id, test_title, assigned_at')
    .eq('teacher_id', user.id)
    .in('problem_id', problem_ids)
    .in('student_id', students)
    .order('assigned_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const hitStudentIds = [...new Set((rows ?? []).map(r => r.student_id).filter(Boolean) as string[])]
  const nameById = new Map<string, string>()
  if (hitStudentIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles').select('id, full_name').in('id', hitStudentIds)
    for (const p of profiles ?? []) nameById.set(p.id, p.full_name ?? 'Ученик')
  }

  const duplicates: DuplicateHit[] = (rows ?? []).map(r => ({
    problem_id: r.problem_id as string,
    student_id: r.student_id as string,
    student_name: nameById.get(r.student_id as string) ?? 'Ученик',
    test_title: r.test_title as string,
    assigned_at: r.assigned_at as string,
  }))

  return NextResponse.json({ duplicates })
}
