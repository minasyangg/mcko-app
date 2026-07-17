import { createAdminClient } from '@/lib/supabase/admin'
import { checkAnswer } from '@/lib/grading/checker'
import { formatAnswerJson } from '@/lib/grading/format-answer-display'

type AdminClient = ReturnType<typeof createAdminClient>

// AI-проверка письменных ответов (manual/text с эталоном). Вынесена из
// submit-роута, чтобы её могли использовать и ученик (submit), и админ
// (принудительное завершение).
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
    return { is_correct: awarded === maxScore, awarded_score: awarded }
  } catch {
    return null
  }
}

// Финализирует попытку: авто-проверяет ответы (объективные — по ключам,
// письменные — AI при наличии эталона), пишет баллы, переводит attempt в
// checked/submitted и пересчитывает накопительный итог (student_final_results).
// Работает через admin-клиент, БЕЗ зависимости от сессии ученика — поэтому
// используется и в submit (ученик), и в принудительном завершении (админ).
// Требует, чтобы попытка была in_progress (иначе вернёт null).
export async function finalizeAttempt(
  attemptId: string,
  opts?: { admin?: AdminClient }
): Promise<{ score: number; max_score: number; status: 'checked' | 'submitted' } | null> {
  const admin = opts?.admin ?? createAdminClient()

  const { data: attempt } = await admin
    .from('attempts')
    .select('id, student_id, status, assignment_id')
    .eq('id', attemptId)
    .single()
  if (!attempt || attempt.status !== 'in_progress') return null

  const { data: assignment } = await admin
    .from('assignments')
    .select('id, test_version_id, max_attempts, test_versions!test_version_id(tests!test_id(scoring_rule_id))')
    .eq('id', attempt.assignment_id)
    .single()
  if (!assignment) return null

  const scoringRuleId: string | null =
    ((assignment as unknown as { test_versions?: { tests?: { scoring_rule_id?: string | null } } }).test_versions?.tests?.scoring_rule_id) ?? null

  const { data: tasks } = await admin
    .from('test_tasks')
    .select('id, task_number, max_score, task_type, grading_method')
    .eq('test_version_id', assignment.test_version_id)
    .order('sort_order', { ascending: true })
  if (!tasks) return null

  const taskIds = tasks.map(t => t.id)

  const [{ data: answerKeys }, { data: savedAnswers }, { data: criteriaItems }] = await Promise.all([
    admin.from('task_answer_keys')
      .select('task_id, correct_answer, grading_method, grading_config, partial_score_rules')
      .in('task_id', taskIds),
    admin.from('attempt_task_answers')
      .select('task_id, answer_json, is_locked, awarded_score, is_correct')
      .eq('attempt_id', attemptId),
    scoringRuleId
      ? admin.from('scoring_rule_items').select('task_number, note').eq('rule_id', scoringRuleId)
      : Promise.resolve({ data: [] as { task_number: number; note: string | null }[] }),
  ])

  const answerKeyMap = new Map((answerKeys ?? []).map(k => [k.task_id, k]))
  const savedAnswerMap = new Map((savedAnswers ?? []).map(a => [a.task_id, a]))
  const criteriaMap = new Map<number, string>()
  for (const item of criteriaItems ?? []) {
    if (item.task_number && item.note?.trim()) criteriaMap.set(item.task_number, item.note.trim())
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

    if (savedAnswer?.is_locked) {
      totalScore += savedAnswer.awarded_score ?? 0
      continue
    }

    const effectiveMethod = answerKey?.grading_method ?? task.grading_method ?? 'manual'

    if (!answerKey) { allAutoChecked = false; continue }

    if (!savedAnswer) {
      if (effectiveMethod !== 'manual') {
        updates.push({ taskId: task.id, is_correct: false, awarded_score: 0, auto_checked: true })
      } else {
        allAutoChecked = false
      }
      continue
    }

    const isManual = effectiveMethod === 'manual'
    const isTextTask = ['short_text', 'manual_review', 'composite'].includes(task.task_type)

    if (isManual && isTextTask) {
      const correctVal = formatAnswerJson(answerKey.correct_answer)
      const studentVal = formatAnswerJson(savedAnswer.answer_json)

      if (correctVal && correctVal !== '—' && studentVal && studentVal !== '—') {
        const criteria = criteriaMap.get(task.task_number) ?? null
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

    if (isManual) { allAutoChecked = false; continue }

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

  await Promise.all(updates.map(u =>
    admin.from('attempt_task_answers')
      .update({ is_correct: u.is_correct, awarded_score: u.awarded_score, auto_checked_at: u.auto_checked ? now : null })
      .eq('attempt_id', attemptId).eq('task_id', u.taskId)
  ))

  const newStatus: 'checked' | 'submitted' = allAutoChecked ? 'checked' : 'submitted'

  await admin.from('attempts').update({
    status: newStatus,
    submitted_at: now,
    score: totalScore,
    max_score: totalMaxScore,
    last_activity_at: now,
    ...(allAutoChecked ? { checked_at: now } : {}),
  }).eq('id', attemptId)

  // Итог теста = результат ПОСЛЕДНЕЙ (только что завершённой) попытки.
  // attempt_count — сколько попыток использовано (завершено), растёт монотонно.
  const { count } = await admin
    .from('attempts')
    .select('id', { count: 'exact', head: true })
    .eq('assignment_id', attempt.assignment_id)
    .eq('student_id', attempt.student_id)
    .in('status', ['submitted', 'checked'])

  const completedCount = count ?? 1
  const allUsed = completedCount >= (assignment.max_attempts ?? 1)

  await admin.from('student_final_results').upsert({
    student_id: attempt.student_id,
    test_version_id: assignment.test_version_id,
    final_score: totalScore,
    max_score: totalMaxScore,
    attempt_count: completedCount,
    last_completed_at: now,
    status: allUsed ? 'completed' : 'in_progress',
    updated_at: now,
  }, { onConflict: 'student_id,test_version_id' })

  return { score: totalScore, max_score: totalMaxScore, status: newStatus }
}
