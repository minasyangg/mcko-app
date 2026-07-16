// Генерация эталонного ответа ИИ для задания книги/библиотеки без ответа:
// решает через solveProblemWithAI и сохраняет в источник (answer_source='ai');
// опционально создаёт task_answer_keys для test_task, уже скопированного
// add-to-test'ом. Всё fail-soft — при любой проблеме источник остаётся без
// ответа, попытки уйдут учителю на ручную проверку (текущее поведение).

import type { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'
import { solveProblemWithAI } from '@/lib/ai/solve-problem'

type AdminClient = ReturnType<typeof createAdminClient>

export interface GeneratedAnswer {
  answerText: string
  gradingMethod: string
}

export async function generateAndSaveAnswer(opts: {
  source: 'book' | 'library'
  problemId: string
  taskId?: string // test_task из add-to-test — вставить ключ после генерации
  admin: AdminClient
}): Promise<GeneratedAnswer | null> {
  const { source, problemId, taskId, admin } = opts

  try {
    let answerText: string | null = null
    let gradingMethod: string | null = null
    // correct_answer в формате поверхности: книги — {text}, библиотека — строка
    let keyAnswer: Json = null

    if (source === 'book') {
      const { data: problem } = await admin
        .from('book_problems')
        .select('id, prompt_md, correct_answer, grading_method, has_images, options, task_type, book_id, books!book_id(subject, grade)')
        .eq('id', problemId)
        .single()
      if (!problem) return null

      if (problem.correct_answer !== null) {
        // гонка: ответ уже появился (учитель/параллельная генерация) — переиспользуем
        keyAnswer = problem.correct_answer
        gradingMethod = problem.grading_method
        answerText = typeof problem.correct_answer === 'object' && problem.correct_answer !== null
          ? String((problem.correct_answer as { text?: unknown }).text ?? '')
          : String(problem.correct_answer)
      } else {
        if (problem.has_images) return null
        const book = problem.books as { subject?: string; grade?: string | null } | null
        const solved = await solveProblemWithAI({
          promptMd: problem.prompt_md,
          options: Array.isArray(problem.options) ? problem.options : null,
          taskType: problem.task_type,
          subject: book ? [book.subject, book.grade ? `${book.grade} класс` : null].filter(Boolean).join(', ') : null,
        })
        if (!solved) return null

        const { data: updated } = await admin
          .from('book_problems')
          .update({
            correct_answer: { text: solved.answerText },
            grading_method: solved.gradingMethod,
            answer_source: 'ai',
            updated_at: new Date().toISOString(),
          })
          .eq('id', problemId)
          .is('correct_answer', null) // защита от гонки
          .select('id')
        if (!updated?.length) return null // кто-то успел раньше — его ответ главнее

        answerText = solved.answerText
        gradingMethod = solved.gradingMethod
        keyAnswer = { text: solved.answerText }
      }
    } else {
      const { data: problem } = await admin
        .from('library_problems')
        .select('id, prompt_text, prompt_html, correct_answer, grading_method, options, task_type, subject, grade, library_problem_media(placement)')
        .eq('id', problemId)
        .single()
      if (!problem) return null

      if (problem.correct_answer !== null) {
        keyAnswer = problem.correct_answer
        gradingMethod = problem.grading_method
        answerText = typeof problem.correct_answer === 'string'
          ? problem.correct_answer
          : JSON.stringify(problem.correct_answer)
      } else {
        const media = (problem.library_problem_media as { placement: string | null }[] | null) ?? []
        if (media.some(m => m.placement !== 'solution')) return null // текстовый ИИ не видит картинок
        const solved = await solveProblemWithAI({
          promptMd: problem.prompt_html ?? problem.prompt_text,
          options: Array.isArray(problem.options) ? problem.options : null,
          taskType: problem.task_type,
          subject: [problem.subject, problem.grade ? `${problem.grade} класс` : null].filter(Boolean).join(', '),
        })
        if (!solved) return null

        const { data: updated } = await admin
          .from('library_problems')
          .update({
            correct_answer: solved.answerText, // конвенция поверхности: plain string
            grading_method: solved.gradingMethod,
            answer_source: 'ai',
            updated_at: new Date().toISOString(),
          })
          .eq('id', problemId)
          .is('correct_answer', null)
          .select('id')
        if (!updated?.length) return null

        answerText = solved.answerText
        gradingMethod = solved.gradingMethod
        keyAnswer = solved.answerText
      }
    }

    if (!answerText || !gradingMethod) return null

    // Ключ для test_task, созданного add-to-test'ом до завершения генерации
    if (taskId) {
      const { data: task } = await admin
        .from('test_tasks').select('id').eq('id', taskId).single()
      if (task) {
        const { error: keyErr } = await admin.from('task_answer_keys').insert({
          task_id: taskId,
          correct_answer: keyAnswer,
          grading_method: gradingMethod,
        })
        // finalize берёт метод из ключа, но редактор теста показывает метод задачи
        if (!keyErr) {
          await admin.from('test_tasks').update({ grading_method: gradingMethod }).eq('id', taskId)
        }
      }
    }

    return { answerText, gradingMethod }
  } catch (e) {
    console.error('[ai-answer] generateAndSaveAnswer failed:', e instanceof Error ? e.message : e)
    return null
  }
}
