import type { createAdminClient } from '@/lib/supabase/admin'
import { buildCompositeAnswerKey } from '@/lib/grading/multi-part-answer'
import type { Json } from '@/types/database'

type AdminClient = ReturnType<typeof createAdminClient>

export type AddProblemResult =
  | { ok: true; taskId: string; taskNumber: number; hasAnswer: boolean; hasImages: boolean }
  | { ok: false; error: string }

/**
 * Вставляет задание из книги (book_problems) в версию теста — ядро
 * POST /api/books/problems/[id]/add-to-test, вынесено сюда, чтобы им мог
 * пользоваться и HTTP-роут, и агент автосборки ДЗ (lib/homework-agent),
 * не дублируя composite-разбор ответа и правило "answer_source, не
 * grading_method" при каждой новой точке вызова.
 *
 * Не делает: проверку прав/принадлежности версии к организации (это разное
 * для HTTP-роута с auth.uid() и агента с service_role — остаётся вызывающей
 * стороне), фоновую ИИ-генерацию ответа при её отсутствии (для этого — сама
 * generateAndSaveAnswer из lib/ai/generate-answer.ts, отдельно после вызова).
 */
export async function addBookProblemToVersion(
  admin: AdminClient,
  opts: { testVersionId: string; bookProblemId: string; taskNumber?: number; maxScore?: number },
): Promise<AddProblemResult> {
  const { data: problem } = await admin
    .from('book_problems')
    .select('*')
    .eq('id', opts.bookProblemId)
    .eq('is_active', true)
    .single()

  if (!problem) return { ok: false, error: 'Book problem not found' }

  let taskNumber = opts.taskNumber
  if (!taskNumber) {
    const { count } = await admin
      .from('test_tasks')
      .select('*', { count: 'exact', head: true })
      .eq('test_version_id', opts.testVersionId)
    taskNumber = (count ?? 0) + 1
  }

  const promptText = problem.prompt_md
    .replace(/<[^>]+>/g, ' ')
    .replace(/\$\$[\s\S]+?\$\$/g, '[формула]')
    .replace(/\$[^$\n]+\$/g, '[формула]')
    .replace(/\s+/g, ' ')
    .trim() || problem.prompt_md.slice(0, 200)

  // Автосборка составного ответа по меткам (а)/б)/… при копировании эталона
  // из книги в тест. Гейт — answer_source, не grading_method: у книжных
  // задач grading_method='manual' почти всегда просто дефолт эвристики
  // detectGradingMethod() для многосоставных ответов (ИИ/скил его не
  // выбирают осознанно), а не решение учителя — учитель мог осознанно
  // выбрать 'manual' только вручную редактируя ответ (answer_source='manual'
  // через форму книги), только этот случай уважаем и не трогаем.
  // У книг correct_answer хранится как {text: "..."} (не голой строкой, как
  // у библиотеки) — распаковываем перед разбором на части.
  const bookAnswerText =
    problem.correct_answer !== null && typeof problem.correct_answer === 'object' && !Array.isArray(problem.correct_answer)
      ? String((problem.correct_answer as Record<string, unknown>).text ?? '') || null
      : typeof problem.correct_answer === 'string' ? problem.correct_answer : null

  const composite = problem.answer_source !== 'manual' && bookAnswerText
    ? buildCompositeAnswerKey(bookAnswerText)
    : { isComposite: false as const, correctAnswerJson: problem.correct_answer }

  const { data: task, error: taskErr } = await admin
    .from('test_tasks')
    .insert({
      test_version_id: opts.testVersionId,
      task_number:     taskNumber,
      sort_order:      taskNumber,
      prompt_text:     promptText,
      prompt_html:     problem.prompt_md,
      task_type:       composite.isComposite ? 'composite' : problem.task_type,
      // Составной ответ проверяется по частям (метод — внутри каждой части в
      // correctAnswerJson), 'normalized' здесь — только номинальная метка
      // конвенции: успешно собранный составной ответ не должен безусловно
      // наследовать problem.grading_method книги ('manual' у большинства) и
      // уходить в ручную проверку целиком несмотря на разбор по частям.
      grading_method:  composite.isComposite ? 'normalized' : problem.grading_method,
      options:         problem.options ?? [],
      max_score:       opts.maxScore ?? 1,
      has_images:      problem.has_images,
      review_status:   'approved',
      book_problem_id: opts.bookProblemId,
      ...(composite.isComposite && composite.answerParts ? { answer_parts: composite.answerParts } : {}),
    })
    .select('id')
    .single()

  if (taskErr || !task) return { ok: false, error: taskErr?.message ?? 'Failed to create task' }

  const hasAnswer = problem.correct_answer !== null && problem.correct_answer !== undefined
  if (hasAnswer) {
    await admin.from('task_answer_keys').insert({
      task_id:        task.id,
      correct_answer: composite.correctAnswerJson,
      grading_method: composite.isComposite ? 'normalized' : problem.grading_method,
    })
  }

  await admin
    .from('book_problems')
    .update({ used_count: (problem.used_count ?? 0) + 1 })
    .eq('id', opts.bookProblemId)

  return { ok: true, taskId: task.id, taskNumber, hasAnswer, hasImages: problem.has_images }
}

interface LibraryMedia {
  storage_path: string
  placement: string | null
  sort_order: number | null
  alt_text: string | null
}

/**
 * Вставляет задание из библиотеки (library_problems) в версию теста — ядро
 * POST /api/library/problems/[id]/add-to-test. См. комментарий у
 * addBookProblemToVersion — то же назначение, тот же контракт «не делает».
 *
 * Отдельная функция, не общий код с addBookProblemToVersion: источники
 * отличаются существеннее, чем разветвление внутри одной функции удобно
 * читать — у книги correct_answer это {text}, у библиотеки голая строка;
 * у библиотеки есть решения (task_solutions) и медиа, физически копируемое
 * между бакетами storage, у книги — только has_images флаг.
 */
export async function addLibraryProblemToVersion(
  admin: AdminClient,
  opts: { testVersionId: string; libraryProblemId: string; taskNumber?: number; maxScore?: number; organizationId: string },
): Promise<AddProblemResult> {
  const { data: problem } = await admin
    .from('library_problems')
    .select('*, library_problem_media(storage_path, placement, sort_order, alt_text)')
    .eq('id', opts.libraryProblemId)
    .eq('is_active', true)
    .single()

  if (!problem) return { ok: false, error: 'Library problem not found' }
  // Задача из чужой (не глобальной) org-библиотеки — доступ запрещён, иначе
  // можно было бы скопировать чужой приватный ответ/решение в свой тест.
  if (problem.organization_id !== null && problem.organization_id !== opts.organizationId) {
    return { ok: false, error: 'Library problem not found' }
  }

  let taskNumber = opts.taskNumber
  if (!taskNumber) {
    const { count } = await admin
      .from('test_tasks')
      .select('*', { count: 'exact', head: true })
      .eq('test_version_id', opts.testVersionId)
    taskNumber = (count ?? 0) + 1
  }

  const maxScore = opts.maxScore ?? problem.default_max_score ?? 1

  // Автосборка составного ответа по меткам (а)/б)/… — гейт answer_source, не
  // grading_method: для library_problems grading_method вообще не выбирается
  // учителем через UI, это всегда просто дефолт эвристики detectGradingMethod().
  const composite = problem.answer_source !== 'manual' && typeof problem.correct_answer === 'string'
    ? buildCompositeAnswerKey(problem.correct_answer)
    : { isComposite: false as const, correctAnswerJson: problem.correct_answer as Json }

  const media = (problem.library_problem_media as LibraryMedia[] | null) ?? []
  const conditionMedia = media.filter(m => m.placement !== 'solution')

  const { data: task, error: taskErr } = await admin
    .from('test_tasks')
    .insert({
      test_version_id:    opts.testVersionId,
      task_number:        taskNumber,
      sort_order:         taskNumber,
      prompt_text:        problem.prompt_text,
      prompt_html:        problem.prompt_html,
      task_type:          composite.isComposite ? 'composite' : problem.task_type,
      grading_method:     composite.isComposite ? 'normalized' : problem.grading_method,
      options:            problem.options ?? [],
      max_score:          maxScore,
      has_images:         conditionMedia.length > 0,
      review_status:      'approved',
      library_problem_id: opts.libraryProblemId,
      ...(composite.isComposite && composite.answerParts ? { answer_parts: composite.answerParts } : {}),
    })
    .select('id')
    .single()

  if (taskErr || !task) return { ok: false, error: taskErr?.message ?? 'Failed to create task' }
  const taskId = task.id

  const hasAnswer = problem.correct_answer !== null && problem.correct_answer !== undefined
  if (hasAnswer) {
    await admin.from('task_answer_keys').insert({
      task_id:        taskId,
      correct_answer: composite.correctAnswerJson,
      grading_method: composite.isComposite ? 'normalized' : problem.grading_method,
      grading_config: problem.grading_config,
    })
  }

  if (problem.solution_html || problem.solution_text) {
    await admin.from('task_solutions').insert({
      task_id:       taskId,
      solution_text: problem.solution_text,
      solution_html: problem.solution_html,
      has_images:    media.some(m => m.placement === 'solution'),
      access_policy: 'by_request',
    })
  }

  // Медиа: физически копируем файл из library-media в task-media (server-side
  // copy, без скачивания через наш бэкенд) — enrichTaskMediaWithUrls
  // (lib/media/signed-urls.ts) всегда строит публичный URL для бакета
  // task-media, независимо от того, откуда пришло задание.
  if (conditionMedia.length > 0) {
    const copied: { storage_path: string; placement: string | null; alt_text: string | null }[] = []
    for (const m of conditionMedia) {
      const destPath = `library-import/${taskId}/${m.storage_path.split('/').pop()}`
      const { error: copyErr } = await admin.storage
        .from('library-media')
        .copy(m.storage_path, destPath, { destinationBucket: 'task-media' })
      if (copyErr) {
        console.error(`[addLibraryProblemToVersion] Не удалось скопировать медиа ${m.storage_path}:`, copyErr.message)
        continue
      }
      copied.push({ storage_path: destPath, placement: m.placement, alt_text: m.alt_text })
    }
    if (copied.length > 0) {
      await admin.from('task_media').insert(
        copied.map((m, i) => ({
          task_id:      taskId,
          storage_path: m.storage_path,
          media_type:   'image',
          placement:    m.placement ?? 'above_text',
          sort_order:   i,
          alt_text:     m.alt_text,
        }))
      )
    }
  }

  await admin
    .from('library_problems')
    .update({ used_count: (problem.used_count ?? 0) + 1 })
    .eq('id', opts.libraryProblemId)

  return { ok: true, taskId, taskNumber, hasAnswer, hasImages: conditionMedia.length > 0 }
}
