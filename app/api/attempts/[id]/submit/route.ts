import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { checkAnswer } from '@/lib/grading/checker'
import type { Json } from '@/types/database'

// AI semantic check for manual/text answers that have a correct_answer key
async function checkWithAI(
  studentAnswer: string,
  correctAnswer: string,
  maxScore: number,
  criteria?: string | null
): Promise<{ is_correct: boolean; awarded_score: number } | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey || !studentAnswer.trim() || !correctAnswer.trim()) return null

  const systemPrompt =
    'Ты ассистент-преподаватель, проверяющий письменные ответы учеников на школьных экзаменах ' +
    '(ОГЭ, ЕГЭ, ВПР). Оценивай по смыслу, а не по дословному совпадению. ' +
    'Синонимы и перефразировки засчитываются. Отвечай строго валидным JSON.'

  const scoringSection = criteria?.trim()
    ? `Критерии оценивания (используй их как основу для выставления балла):\n${criteria.trim()}`
    : maxScore === 1
      ? `Шкала оценивания:\n- 1 балл: ответ верный по смыслу\n- 0 баллов: ответ неверный или не по теме`
      : `Шкала оценивания:\n` + [
          `- ${maxScore} баллов: ответ полностью верный, раскрыт полностью`,
          maxScore >= 3 ? `- ${Math.round(maxScore * 0.67)}–${maxScore - 1} баллов: ответ в основном верный, но неполный или с незначительными ошибками` : null,
          `- 1 балл: ответ частично верный, но с существенными пропусками или ошибками`,
          `- 0 баллов: ответ неверный, не по теме или отсутствует`,
        ].filter(Boolean).join('\n')

  const userPrompt =
    `Оцени письменный ответ ученика по шкале от 0 до ${maxScore}.\n\n` +
    `Эталонный ответ: ${correctAnswer.slice(0, 800)}\n\n` +
    `Ответ ученика: ${studentAnswer.slice(0, 800)}\n\n` +
    `${scoringSection}\n\n` +
    `Орфография и пунктуация не учитываются.\n\n` +
    `Верни JSON: {"awarded_score": <целое число от 0 до ${maxScore}>}`

  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.0,
        max_tokens: 50,
      }),
    })
    if (!res.ok) return null
    const json = await res.json()
    const content = JSON.parse(json.choices?.[0]?.message?.content ?? '{}')
    const awarded = Math.min(Math.max(Math.round(Number(content.awarded_score)) || 0, 0), maxScore)
    // Derive is_correct from the score — don't trust the model's boolean
    return { is_correct: awarded === maxScore, awarded_score: awarded }
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
    .select('id, test_version_id, max_attempts, test_versions!test_version_id(tests!test_id(scoring_rule_id))')
    .eq('id', attempt.assignment_id)
    .single()

  if (!assignment) {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
  }

  const scoringRuleId: string | null =
    ((assignment as any).test_versions as any)?.tests?.scoring_rule_id ?? null

  const { data: tasks } = await supabase
    .from('test_tasks')
    .select('id, task_number, max_score, task_type, grading_method')
    .eq('test_version_id', assignment.test_version_id)
    .order('sort_order', { ascending: true })

  if (!tasks) {
    return NextResponse.json({ error: 'Failed to load tasks' }, { status: 500 })
  }

  const taskIds = tasks.map((t) => t.id)

  // task_answer_keys are hidden from students by RLS — must use admin client
  const admin = createAdminClient()
  const [{ data: answerKeys }, { data: savedAnswers }, { data: criteriaItems }] = await Promise.all([
    admin
      .from('task_answer_keys')
      .select('task_id, correct_answer, grading_method, grading_config, partial_score_rules')
      .in('task_id', taskIds),
    supabase
      .from('attempt_task_answers')
      .select('task_id, answer_json, is_locked, awarded_score, is_correct')
      .eq('attempt_id', attemptId),
    scoringRuleId
      ? admin.from('scoring_rule_items').select('task_number, note').eq('rule_id', scoringRuleId)
      : Promise.resolve({ data: [] as { task_number: number; note: string | null }[] }),
  ])

  const answerKeyMap = new Map((answerKeys ?? []).map((k) => [k.task_id, k]))
  const savedAnswerMap = new Map((savedAnswers ?? []).map((a) => [a.task_id, a]))

  // Criteria by task_number (from scoring rule note field)
  const criteriaMap = new Map<number, string>()
  for (const item of criteriaItems ?? []) {
    if (item.task_number && item.note?.trim()) {
      criteriaMap.set(item.task_number, item.note.trim())
    }
  }

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

    // LOCKED task — teacher confirmed correct; carry forward score, skip re-evaluation
    if (savedAnswer?.is_locked) {
      const score = savedAnswer.awarded_score ?? 0
      totalScore += score
      // Don't add to updates — keep the locked row as-is
      // But we need to ensure this task doesn't block allAutoChecked
      continue
    }

    // Effective grading method: from answer key if exists, else from task itself
    const effectiveMethod = answerKey?.grading_method ?? (task as any).grading_method ?? 'manual'

    if (!answerKey) {
      allAutoChecked = false
      continue
    }

    if (!savedAnswer) {
      // Has key but no answer → 0 score, auto-graded as incorrect
      if (effectiveMethod !== 'manual') {
        updates.push({ taskId: task.id, is_correct: false, awarded_score: 0, auto_checked: true })
      } else {
        allAutoChecked = false
      }
      continue
    }

    const isManual = effectiveMethod === 'manual'
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
        const criteria = criteriaMap.get((task as any).task_number) ?? null
        const aiResult = await checkWithAI(studentVal, correctVal, maxScore, criteria)
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
      effectiveMethod,
      answerKey.grading_config,
      maxScore,
      answerKey.partial_score_rules
    )

    totalScore += result.awarded_score
    updates.push({ taskId: task.id, is_correct: result.is_correct, awarded_score: result.awarded_score, auto_checked: true })
  }

  // Write grading results for non-locked tasks (parallel)
  await Promise.all(updates.map(u =>
    supabase
      .from('attempt_task_answers')
      .update({
        is_correct: u.is_correct,
        awarded_score: u.awarded_score,
        auto_checked_at: u.auto_checked ? now : null,
      })
      .eq('attempt_id', attemptId)
      .eq('task_id', u.taskId)
  ))

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

  // Compute cumulative score: MAX(awarded_score) per task across all completed attempts
  const [{ data: allAttemptIds }, completedCountResult] = await Promise.all([
    supabase
      .from('attempts')
      .select('id')
      .eq('assignment_id', attempt.assignment_id)
      .eq('student_id', user.id)
      .in('status', ['submitted', 'checked']),
    supabase
      .from('attempts')
      .select('id', { count: 'exact', head: true })
      .eq('assignment_id', attempt.assignment_id)
      .eq('student_id', user.id)
      .in('status', ['submitted', 'checked']),
  ])

  const ids = (allAttemptIds ?? []).map(a => a.id)
  if (ids.length > 0) {
    const { data: allTaskAnswers } = await supabase
      .from('attempt_task_answers')
      .select('task_id, awarded_score')
      .in('attempt_id', ids)

    const taskBest = new Map<string, number>()
    for (const ans of allTaskAnswers ?? []) {
      if (!ans.task_id) continue
      taskBest.set(ans.task_id, Math.max(taskBest.get(ans.task_id) ?? 0, ans.awarded_score ?? 0))
    }
    const cumulativeScore = [...taskBest.values()].reduce((s, v) => s + v, 0)

    const completedCount = completedCountResult.count ?? 0
    const allUsed = completedCount >= (assignment.max_attempts ?? 1)

    await supabase.from('student_final_results').upsert({
      student_id: user.id,
      test_version_id: assignment.test_version_id,
      final_score: cumulativeScore,
      max_score: totalMaxScore,
      attempt_count: completedCount,
      last_completed_at: now,
      status: allUsed ? 'completed' : 'in_progress',
      updated_at: now,
    }, { onConflict: 'student_id,test_version_id' })
  }

  return NextResponse.json({ attempt_id: attemptId, score: totalScore, max_score: totalMaxScore, status: newStatus })
}
