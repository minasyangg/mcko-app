import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { zUuid } from '@/lib/uuid'
import { createClient } from '@/lib/supabase/server'

const schema = z.object({
  // Задачи, которые учитель собирается добавить (id в книге/библиотеке).
  // Не нужен вместе с test_id — тогда сервер сам берёт задачи опубликованной
  // версии теста (сценарий «Назначить тест»: там известен весь тест, а не
  // отдельная задача).
  problem_ids: z.array(zUuid()).min(1).max(300).optional(),
  // Тест целиком — для экрана назначения (до создания assignment ещё нет
  // ни test_version_id, ни своего набора problem_ids на клиенте).
  test_id: zUuid().optional(),
  // Куда добавляет одну задачу — по версии теста определяем адресатов
  // (сценарий AddToTestDialog: задача уже добавляется в существующее ДЗ).
  test_version_id: zUuid().optional(),
  // Адресаты напрямую: конкретный ученик или группа (разворачивается в
  // участников на сервере) — либо явный список id.
  student_id: zUuid().optional(),
  group_id: zUuid().optional(),
  student_ids: z.array(zUuid()).max(200).optional(),
  // Явный признак «это назначение на много учеников сразу» — нужен пороговый
  // (не поштучный) режим предупреждения. group_id сам по себе это подразумевает;
  // is_group нужен, когда адресаты уже развёрнуты на клиенте (программа/road
  // map: её участники — обычный список id, не group_members конкретной группы,
  // хотя по смыслу это то же самое «назначаю на много учеников разом»).
  is_group: z.boolean().optional(),
}).refine(d => d.problem_ids || d.test_id, {
  message: 'Нужен либо problem_ids, либо test_id',
})

export interface DuplicateHit {
  problem_id: string
  student_id: string
  student_name: string
  test_title: string
  assigned_at: string
}

// Пороги мягкого группового предупреждения (по требованию пользователя):
// если у группы объединять по каждой задаче бессмысленно — 20 разных
// учеников с одним общим совпадением не значит «это ДЗ дублирует другое»,
// поэтому смотрим на ДОЛЮ учеников с ЗАМЕТНЫМ личным пересечением.
const GROUP_MIN_STUDENT_SHARE = 0.5   // >50% учеников группы...
const GROUP_MIN_OVERLAP_SHARE = 0.3   // ...у кого совпало >30% задач теста

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
  const { test_id, test_version_id, student_id, group_id, student_ids, is_group } = parsed.data
  let { problem_ids } = parsed.data

  // test_id → задачи его опубликованной версии (экран «Назначить тест»:
  // сравниваем ВЕСЬ тест, а не одну задачу — problem_ids с клиента не нужен).
  if (!problem_ids && test_id) {
    const { data: test } = await supabase
      .from('tests').select('current_published_version_id').eq('id', test_id).single()
    if (!test?.current_published_version_id) return NextResponse.json({ duplicates: [] })

    const { data: tasks } = await supabase
      .from('test_tasks')
      .select('book_problem_id, library_problem_id')
      .eq('test_version_id', test.current_published_version_id)

    problem_ids = [...new Set(
      (tasks ?? [])
        .map(t => t.book_problem_id ?? t.library_problem_id)
        .filter((id): id is string => id != null)
    )]
    if (problem_ids.length === 0) return NextResponse.json({ duplicates: [] })
  }
  if (!problem_ids) return NextResponse.json({ duplicates: [] })

  // Определяем адресатов: явный список / ученик / группа — либо, если ничего
  // не передано, выводим из назначений целевого ДЗ (групповые раскрываются
  // в участников — старый путь для AddToTestDialog).
  let students = student_ids ?? (student_id ? [student_id] : [])
  // isGroupTarget — знак того, что нужна групповая логика порогов (доля
  // учеников с заметным пересечением), а не список конкретных совпадений
  // как для одного адресата.
  const isGroupTarget = !!group_id || !!is_group
  if (group_id) {
    const { data: members } = await supabase
      .from('group_members').select('user_id').eq('group_id', group_id)
    students = [...new Set([...students, ...(members ?? []).map(m => m.user_id)])]
  }
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

  // Адресат ещё не выбран/ДЗ никому не назначено — сравнивать не с кем
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

  // Для одиночного адресата (ученик / явный список / через test_version_id)
  // пороги не нужны — учителю показывают сам факт и список совпадений, решение
  // за ним. Пороги — только для группы: иначе один ученик с 100% пересечением
  // в группе из 20 не должен выглядеть как «всей группе это уже задавали».
  if (!isGroupTarget) {
    return NextResponse.json({ duplicates, group_warning: null })
  }

  const overlapByStudent = new Map<string, Set<string>>()
  for (const r of rows ?? []) {
    const sid = r.student_id as string
    if (!overlapByStudent.has(sid)) overlapByStudent.set(sid, new Set())
    overlapByStudent.get(sid)!.add(r.problem_id as string)
  }
  const overlapShares = students.map(sid => (overlapByStudent.get(sid)?.size ?? 0) / problem_ids!.length)
  const studentsWithNotableOverlap = overlapShares.filter(share => share >= GROUP_MIN_OVERLAP_SHARE).length
  const affectedShare = studentsWithNotableOverlap / students.length
  const groupWarning = affectedShare >= GROUP_MIN_STUDENT_SHARE
    ? {
        affected_students: studentsWithNotableOverlap,
        total_students: students.length,
        // средний % пересечения именно среди «заметно задетых» — общий средний
        // по всей группе смазал бы картину нулями от тех, кого не касается
        avg_overlap_percent: Math.round(
          100 * overlapShares.filter(s => s >= GROUP_MIN_OVERLAP_SHARE)
            .reduce((sum, s) => sum + s, 0) / studentsWithNotableOverlap
        ),
      }
    : null

  return NextResponse.json({ duplicates, group_warning: groupWarning })
}
