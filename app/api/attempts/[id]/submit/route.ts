import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkAnswer } from '@/lib/grading/checker'
import type { Json } from '@/types/database'

// AI semantic check for manual/text answers that have a correct_answer key
async function checkWithAI(
  studentAnswer: string,
  correctAnswer: string,
  maxScore: number
): Promise<{ is_correct: boolean; awarded_score: number } | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey || !studentAnswer.trim() || !correctAnswer.trim()) return null

  try {
    const prompt = `Оцени ответ ученика. Отвечай строго JSON без пояснений.
Правильный ответ: ${correctAnswer.slice(0, 500)}
Ответ ученика: ${studentAnswer.slice(0, 500)}
Максимальный балл: ${maxScore}
Верни: {"is_correct": bool, "awarded_score": число_от_0_до_${maxScore}}`

    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.0,
        max_tokens: 100,
      }),
    })
    if (!res.ok) return null
    const json = await res.json()
    const content = JSON.parse(json.choices?.[0]?.message?.content ?? '{}')
    const awarded = Math.min(Math.max(Number(content.awarded_score) || 0, 0), maxScore)
    return { is_correct: !!content.is_correct, awarded_score: awarded }
  } catch {
    return null
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: attemptId } = await params

  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: attempt, error: attemptError } = await supabase
    .from('attempts')
    .select('id, student_id, status, assignment_id')
    .eq('id', attemptId)
    .single()

  if (attemptError || !attempt) {
    return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })
  }
  if (attempt.student_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (attempt.status !== 'in_progress') {
    return NextResponse.json({ error: 'Attempt is not in progress' }, { status: 409 })
  }

  const { data: assignment } = await supabase
    .from('assignments')
    .select('id, test_version_id')
    .eq('id', attempt.assignment_id)
    .single()

  if (!assignment) {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
  }

  const { data: tasks } = await supabase
    .from('test_tasks')
    .select('id, max_score, task_type')
    .eq('test_version_id', assignment.test_version_id)
    .order('sort_order', { ascending: true })

  if (!tasks) {
    return NextResponse.json({ error: 'Failed to load tasks' }, { status: 500 })
  }

  const taskIds = tasks.map((t) => t.id)

  const [{ data: answerKeys }, { data: savedAnswers }] = await Promise.all([
    supabase
      .from('task_answer_keys')
      .select('task_id, correct_answer, grading_method, grading_config, partial_score_rules')
      .in('task_id', taskIds),
    supabase
      .from('attempt_task_answers')
      .select('task_id, answer_json, answer_version')
      .eq('attempt_id', attemptId),
  ])

  const answerKeyMap = new Map((answerKeys ?? []).map((k) => [k.task_id, k]))
  const savedAnswerMap = new Map((savedAnswers ?? []).map((a) => [a.task_id, a]))

  const now = new Date().toISOString()

  let totalScore = 0
  let totalMaxScore = 0
  let allAutoChecked = true

  const updates: Array<{ taskId: string; is_correct: boolean | null; awarded_score: number; auto_checked: boolean }> = []

  for (const task of tasks) {
    const maxScore = task.max_score ?? 1
    totalMaxScore += maxScore

    const savedAnswer = savedAnswerMap.get(task.id)
    const answerKey = answerKeyMap.get(task.id)

    // No answer key at all → needs teacher review
    if (!answerKey) {
      allAutoChecked = false
      continue
    }

    if (!savedAnswer) {
      // Has key but no answer → 0 score, auto-graded as incorrect
      if (answerKey.grading_method !== 'manual') {
        updates.push({ taskId: task.id, is_correct: false, awarded_score: 0, auto_checked: true })
      } else {
        allAutoChecked = false
      }
      continue
    }

    const isManual = answerKey.grading_method === 'manual'
    const isTextTask = ['short_text', 'manual_review', 'composite'].includes(task.task_type)

    // For manual_review tasks with a correct_answer: try AI semantic check
    if (isManual && isTextTask) {
      const correctVal = typeof answerKey.correct_answer === 'string'
        ? answerKey.correct_answer
        : JSON.stringify(answerKey.correct_answer)
      const studentVal = typeof savedAnswer.answer_json === 'object' && savedAnswer.answer_json !== null
        ? (
            (savedAnswer.answer_json as Record<string, unknown>).text as string
            ?? (savedAnswer.answer_json as Record<string, unknown>).value as string
            ?? JSON.stringify(savedAnswer.answer_json)
          )
        : String(savedAnswer.answer_json ?? '')

      if (correctVal && studentVal) {
        const aiResult = await checkWithAI(studentVal, correctVal, maxScore)
        if (aiResult) {
          totalScore += aiResult.awarded_score
          updates.push({ taskId: task.id, is_correct: aiResult.is_correct, awarded_score: aiResult.awarded_score, auto_checked: true })
          continue
        }
      }
      allAutoChecked = false
      continue
    }

    if (isManual) {
      allAutoChecked = false
      continue
    }

    const result = checkAnswer(
      savedAnswer.answer_json ?? null,
      answerKey.correct_answer,
      answerKey.grading_method,
      answerKey.grading_config,
      maxScore,
      answerKey.partial_score_rules
    )

    totalScore += result.awarded_score
    updates.push({ taskId: task.id, is_correct: result.is_correct, awarded_score: result.awarded_score, auto_checked: true })
  }

  // Write grading results
  for (const u of updates) {
    await supabase
      .from('attempt_task_answers')
      .update({
        is_correct: u.is_correct,
        awarded_score: u.awarded_score,
        auto_checked_at: u.auto_checked ? now : null,
      })
      .eq('attempt_id', attemptId)
      .eq('task_id', u.taskId)
  }

  const newStatus = allAutoChecked ? 'checked' : 'submitted'

  const { error: updateErr } = await supabase
    .from('attempts')
    .update({
      status: newStatus,
      submitted_at: now,
      score: totalScore,
      max_score: totalMaxScore,
      last_activity_at: now,
      ...(allAutoChecked ? { checked_at: now } : {}),
    })
    .eq('id', attemptId)

  if (updateErr) {
    return NextResponse.json({ error: 'Failed to finalize attempt' }, { status: 500 })
  }

  return NextResponse.json({ attempt_id: attemptId, score: totalScore, max_score: totalMaxScore, status: newStatus })
}
