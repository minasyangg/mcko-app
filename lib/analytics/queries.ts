import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export interface TestAttemptStats {
  totalAttempts: number
  completedAttempts: number
  completionRate: number
  avgScore: number
  medianScore: number
  avgPercentage: number
  maxPossibleScore: number
}

export interface TaskStat {
  taskId: string
  taskNumber: number
  promptText: string
  maxScore: number
  totalAnswers: number
  correctCount: number
  correctRate: number
  avgAwarded: number
  solutionRequestCount: number
}

export interface AttemptRow {
  attemptId: string
  studentId: string
  studentName: string
  grade: string | null
  groupName: string | null
  testTitle: string
  score: number
  maxScore: number
  percentage: number
  status: string
  submittedAt: string | null
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

export async function getTestAttemptStats(
  supabase: SupabaseClient<Database>,
  testVersionId: string
): Promise<TestAttemptStats> {
  const { data: attempts } = await supabase
    .from('attempts')
    .select('id, status, score, max_score')
    .eq('assignment_id', supabase.from('assignments').select('id').eq('test_version_id', testVersionId) as any)

  // Fallback: query via assignments
  const { data: assignments } = await supabase
    .from('assignments')
    .select('id')
    .eq('test_version_id', testVersionId)

  const assignmentIds = (assignments ?? []).map(a => a.id)
  if (assignmentIds.length === 0) return { totalAttempts: 0, completedAttempts: 0, completionRate: 0, avgScore: 0, medianScore: 0, avgPercentage: 0, maxPossibleScore: 0 }

  const { data: allAttempts } = await supabase
    .from('attempts')
    .select('id, status, score, max_score')
    .in('assignment_id', assignmentIds)

  const all = allAttempts ?? []
  const completed = all.filter(a => ['submitted', 'checked'].includes(a.status))
  const scores = completed.map(a => a.score ?? 0)
  const maxPossible = all[0]?.max_score ?? 0
  const avgScore = scores.length > 0 ? scores.reduce((s, v) => s + v, 0) / scores.length : 0
  const percentages = maxPossible > 0 ? scores.map(s => (s / maxPossible) * 100) : scores

  return {
    totalAttempts: all.length,
    completedAttempts: completed.length,
    completionRate: all.length > 0 ? Math.round((completed.length / all.length) * 100) : 0,
    avgScore: Math.round(avgScore * 10) / 10,
    medianScore: median(scores),
    avgPercentage: percentages.length > 0 ? Math.round(percentages.reduce((s, v) => s + v, 0) / percentages.length) : 0,
    maxPossibleScore: maxPossible,
  }
}

export async function getTaskStats(
  supabase: SupabaseClient<Database>,
  testVersionId: string
): Promise<TaskStat[]> {
  const { data: tasks } = await supabase
    .from('test_tasks')
    .select('id, task_number, prompt_text, max_score')
    .eq('test_version_id', testVersionId)
    .order('sort_order', { ascending: true })

  if (!tasks?.length) return []

  const taskIds = tasks.map(t => t.id)

  const { data: answers } = await supabase
    .from('attempt_task_answers')
    .select('task_id, is_correct, awarded_score, answer_json')
    .in('task_id', taskIds)

  const { data: solRequests } = await supabase
    .from('solution_requests')
    .select('task_id')
    .in('task_id', taskIds)

  const answersByTask = new Map<string, typeof answers>()
  for (const a of answers ?? []) {
    if (!a.task_id) continue
    if (!answersByTask.has(a.task_id)) answersByTask.set(a.task_id, [])
    answersByTask.get(a.task_id)!.push(a)
  }

  const requestsByTask = new Map<string, number>()
  for (const r of solRequests ?? []) {
    if (!r.task_id) continue
    requestsByTask.set(r.task_id, (requestsByTask.get(r.task_id) ?? 0) + 1)
  }

  return tasks.map(task => {
    const taskAnswers = answersByTask.get(task.id) ?? []
    const correct = taskAnswers.filter(a => a.is_correct === true).length
    const totalScore = taskAnswers.reduce((s, a) => s + (a.awarded_score ?? 0), 0)

    return {
      taskId: task.id,
      taskNumber: task.task_number,
      promptText: task.prompt_text,
      maxScore: task.max_score ?? 1,
      totalAnswers: taskAnswers.length,
      correctCount: correct,
      correctRate: taskAnswers.length > 0 ? Math.round((correct / taskAnswers.length) * 100) : 0,
      avgAwarded: taskAnswers.length > 0 ? Math.round((totalScore / taskAnswers.length) * 10) / 10 : 0,
      solutionRequestCount: requestsByTask.get(task.id) ?? 0,
    }
  })
}

export async function getAttemptRows(
  supabase: SupabaseClient<Database>,
  filters: { testVersionId?: string; testId?: string; organizationId?: string }
): Promise<AttemptRow[]> {
  let query = supabase
    .from('attempts')
    .select(`
      id, status, score, max_score, submitted_at,
      student_id,
      profiles ( full_name, grade ),
      assignments (
        group_id,
        groups ( name ),
        test_versions!test_version_id (
          id,
          tests!test_id ( title )
        )
      )
    `)
    .in('status', ['submitted', 'checked'])
    .order('submitted_at', { ascending: false })
    .limit(500)

  if (filters.testVersionId) {
    const { data: asgns } = await supabase
      .from('assignments').select('id').eq('test_version_id', filters.testVersionId)
    const ids = (asgns ?? []).map(a => a.id)
    if (ids.length === 0) return []
    query = query.in('assignment_id', ids)
  }

  const { data } = await query

  return (data ?? []).map(a => {
    const profile = a.profiles as any
    const assignment = a.assignments as any
    const group = assignment?.groups as any
    const tv = assignment?.test_versions as any
    const test = tv?.tests as any
    const maxScore = a.max_score ?? 0

    return {
      attemptId: a.id,
      studentId: a.student_id,
      studentName: profile?.full_name ?? '—',
      grade: profile?.grade ?? null,
      groupName: group?.name ?? null,
      testTitle: test?.title ?? '—',
      score: a.score ?? 0,
      maxScore,
      percentage: maxScore > 0 ? Math.round(((a.score ?? 0) / maxScore) * 100) : 0,
      status: a.status,
      submittedAt: a.submitted_at,
    }
  })
}
