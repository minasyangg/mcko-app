import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const testVersionId = searchParams.get('test_version_id')

  // Load attempts with related data
  let assignmentIds: string[] | null = null
  if (testVersionId) {
    const { data: asgns } = await supabase
      .from('assignments').select('id').eq('test_version_id', testVersionId)
    assignmentIds = (asgns ?? []).map(a => a.id)
    if (assignmentIds.length === 0) {
      return new Response('Ученик,Класс,Группа,Тест,Тип,Балл,Макс балл,Процент,Статус,Дата\n', {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="results.csv"' }
      })
    }
  }

  let query = supabase
    .from('attempts')
    .select(`
      id, status, score, max_score, submitted_at,
      student_id,
      profiles ( full_name, grade ),
      assignments (
        group_id,
        kind,
        groups ( name ),
        test_versions ( tests ( title, kind ) )
      )
    `)
    .in('status', ['submitted', 'checked'])
    .order('submitted_at', { ascending: false })
    .limit(1000)

  if (assignmentIds) {
    query = query.in('assignment_id', assignmentIds)
  }

  const { data: attempts } = await query

  // Load tasks for task-level columns
  let taskHeaders: string[] = []
  let taskIdOrder: string[] = []

  if (testVersionId) {
    const { data: tasks } = await supabase
      .from('test_tasks')
      .select('id, task_number')
      .eq('test_version_id', testVersionId)
      .order('sort_order', { ascending: true })

    taskIdOrder = (tasks ?? []).map(t => t.id)
    taskHeaders = (tasks ?? []).map(t => `Задача ${t.task_number}`)
  }

  // Load task answers for these attempts
  const attemptIds = (attempts ?? []).map(a => a.id)
  const answersByAttempt = new Map<string, Map<string, number>>()

  if (taskIdOrder.length > 0 && attemptIds.length > 0) {
    const { data: answers } = await supabase
      .from('attempt_task_answers')
      .select('attempt_id, task_id, awarded_score')
      .in('attempt_id', attemptIds)
      .in('task_id', taskIdOrder)

    for (const ans of answers ?? []) {
      if (!ans.attempt_id || !ans.task_id) continue
      if (!answersByAttempt.has(ans.attempt_id)) answersByAttempt.set(ans.attempt_id, new Map())
      answersByAttempt.get(ans.attempt_id)!.set(ans.task_id, ans.awarded_score ?? 0)
    }
  }

  // Build CSV
  const headers = ['Ученик', 'Класс', 'Группа', 'Тест', 'Тип', 'Балл', 'Макс балл', 'Процент', 'Статус', 'Дата', ...taskHeaders]

  const escapeCell = (v: string | number | null | undefined) => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }

  const rows: string[] = [headers.map(escapeCell).join(',')]

  for (const a of attempts ?? []) {
    const profile = a.profiles as any
    const assignment = a.assignments as any
    const group = assignment?.groups as any
    const tv = assignment?.test_versions as any
    const test = tv?.tests as any

    const maxScore = a.max_score ?? 0
    const score = a.score ?? 0
    const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0
    const status = a.status === 'checked' ? 'Проверено' : 'Отправлено'
    const date = a.submitted_at ? new Date(a.submitted_at).toLocaleDateString('ru-RU') : ''
    // метка назначения важнее типа теста (roadmap может назначить тест как ДЗ)
    const kind = (assignment?.kind ?? test?.kind) === 'homework' ? 'ДЗ' : 'Тест'

    const base = [
      profile?.full_name ?? '',
      profile?.grade ?? '',
      group?.name ?? '',
      test?.title ?? '',
      kind,
      score,
      maxScore,
      `${pct}%`,
      status,
      date,
    ]

    const taskCols = taskIdOrder.map(tid =>
      answersByAttempt.get(a.id)?.get(tid) ?? ''
    )

    rows.push([...base, ...taskCols].map(escapeCell).join(','))
  }

  const csv = '﻿' + rows.join('\n') // BOM for Excel UTF-8

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="results${testVersionId ? `-${testVersionId.slice(0, 8)}` : ''}.csv"`,
    },
  })
}
