import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkAnswer } from '@/lib/grading/checker'
import type { Json } from '@/types/database'

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

  // Verify attempt belongs to current user and is in_progress
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

  // Load assignment to get test_version_id
  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select('id, test_version_id')
    .eq('id', attempt.assignment_id)
    .single()

  if (assignmentError || !assignment) {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
  }

  // Load all tasks for this test version
  const { data: tasks, error: tasksError } = await supabase
    .from('test_tasks')
    .select('id, max_score, task_type')
    .eq('test_version_id', assignment.test_version_id)
    .order('sort_order', { ascending: true })

  if (tasksError || !tasks) {
    return NextResponse.json({ error: 'Failed to load tasks' }, { status: 500 })
  }

  // Load all answer keys for these tasks
  const taskIds = tasks.map((t) => t.id)
  const { data: answerKeys, error: keysError } = await supabase
    .from('task_answer_keys')
    .select('task_id, correct_answer, grading_method, grading_config, partial_score_rules')
    .in('task_id', taskIds)

  if (keysError) {
    console.error('Failed to load answer keys:', keysError)
  }

  // Load saved answers for this attempt
  const { data: savedAnswers, error: answersError } = await supabase
    .from('attempt_task_answers')
    .select('task_id, answer_json, answer_version')
    .eq('attempt_id', attemptId)

  if (answersError) {
    console.error('Failed to load saved answers:', answersError)
  }

  const answerKeyMap = new Map(
    (answerKeys ?? []).map((k) => [k.task_id, k])
  )
  const savedAnswerMap = new Map(
    (savedAnswers ?? []).map((a) => [a.task_id, a])
  )

  const now = new Date().toISOString()

  let totalScore = 0
  let totalMaxScore = 0
  let allAutoChecked = true

  // Grade each task
  for (const task of tasks) {
    totalMaxScore += task.max_score ?? 1

    const savedAnswer = savedAnswerMap.get(task.id)
    const answerKey = answerKeyMap.get(task.id)

    if (!savedAnswer || !answerKey) {
      // No answer or no key — skip auto-grading for this task
      if (answerKey && answerKey.grading_method !== 'manual') {
        allAutoChecked = false
      }
      continue
    }

    const result = checkAnswer(
      savedAnswer.answer_json ?? null,
      answerKey.correct_answer,
      answerKey.grading_method,
      answerKey.grading_config,
      task.max_score ?? 1,
      answerKey.partial_score_rules
    )

    if (answerKey.grading_method === 'manual') {
      allAutoChecked = false
    }

    totalScore += result.awarded_score

    // Update the answer with grading result
    const { error: updateAnswerError } = await supabase
      .from('attempt_task_answers')
      .update({
        is_correct: result.is_correct,
        awarded_score: result.awarded_score,
        normalized_answer_json: result.normalized_answer_json,
        auto_checked_at: answerKey.grading_method !== 'manual' ? now : null,
      })
      .eq('attempt_id', attemptId)
      .eq('task_id', task.id)

    if (updateAnswerError) {
      console.error('Failed to update answer grading:', updateAnswerError)
    }
  }

  // Update attempt status
  const newStatus = allAutoChecked ? 'checked' : 'submitted'

  const { error: updateAttemptError } = await supabase
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

  if (updateAttemptError) {
    console.error('Failed to update attempt:', updateAttemptError)
    return NextResponse.json({ error: 'Failed to finalize attempt' }, { status: 500 })
  }

  return NextResponse.json(
    {
      attempt_id: attemptId,
      score: totalScore,
      max_score: totalMaxScore,
      status: newStatus,
    },
    { status: 200 }
  )
}
