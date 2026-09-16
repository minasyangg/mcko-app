import type { createAdminClient } from '@/lib/supabase/admin'
import { buildCompositeAnswerKey } from '@/lib/grading/multi-part-answer'

type AdminClient = ReturnType<typeof createAdminClient>

export interface RuleSource {
  sourceKind: 'book' | 'library_topic' | 'library_exam'
  bookId: string | null
  libraryTopicId: string | null
  examType: string | null
  subject: string | null
  weight: number
}

export interface RuleConfig {
  taskCount: number
  mistakesPct: number
  difficulty: 'standard' | 'advanced' | 'mixed'
  allowImages: boolean
  requireAnswer: boolean
  /** Дней назад, дальше которых дедуп по assigned_problems не учитывается. */
  dedupWindowDays: number
}

export interface PickedProblem {
  source: 'book' | 'library'
  problemId: string
  taskNumber: string | null // book_problems.task_number, для сортировки внутри книги
  maxScore: number
  /** Пул, из которого взята задача — для сообщения учителю («N на ошибки / M по теме»). */
  pool: 'mistakes' | 'new'
}

export interface PickResult {
  picked: PickedProblem[]
  /** Требуемое количество не набрано даже после всех фолбэков. */
  shortfall: boolean
  /** Что именно пришлось ослабить, чтобы собрать состав — для rationale предложения. */
  relaxations: string[]
}

const MIN_ACCEPTABLE_RATIO = 0.5 // <50% от task_count — не строить ДЗ, см. план

/**
 * Подбирает конкретные задания под уже выбранную тему (см. diagnose.ts) —
 * часть на повторение прошлых ошибок, часть — новые по теме, с гарантией
 * минимум одного задания из каждого разрешённого источника, дедупликацией
 * через assigned_problems и деградацией фильтров при нехватке материала.
 *
 * Не публикует и не создаёт тест — только отбирает problemId; сборка
 * test_tasks — задача build.ts (lib/tests/add-problem-to-version.ts).
 */
export async function pickProblems(
  admin: AdminClient,
  opts: {
    libraryTopicId: string
    teacherId: string
    studentIds: string[]
    rule: RuleConfig
    sources: RuleSource[]
  }
): Promise<PickResult> {
  const relaxations: string[] = []
  const nMistakes = Math.round(opts.rule.taskCount * opts.rule.mistakesPct / 100)
  const nNew = opts.rule.taskCount - nMistakes

  const excludedIds = await loadRecentlyAssignedProblemIds(
    admin, opts.teacherId, opts.studentIds, opts.rule.dedupWindowDays
  )

  // Пул «на ошибки»: задачи по этой же теме, которые уже задавались этим
  // учителем этим ученикам (повтор ранее пройденной задачи — осознанный
  // приём, допустим), исключая только совсем свежие (окно дедупа).
  const mistakesPool = await loadCandidates(admin, {
    libraryTopicId: opts.libraryTopicId,
    sources: opts.sources,
    rule: opts.rule,
    excludeIds: excludedIds,
  })

  const pickedMistakes = takeWithSourceDiversity(mistakesPool, nMistakes, opts.sources)
  const pickedIds = new Set(pickedMistakes.map(p => p.problemId))

  // Пул «новое»: та же тема, но исключаем и окно дедупа, и уже отобранное
  // для «ошибок» — иначе одна и та же задача может попасть в оба пула.
  const newPool = await loadCandidates(admin, {
    libraryTopicId: opts.libraryTopicId,
    sources: opts.sources,
    rule: opts.rule,
    excludeIds: new Set([...excludedIds, ...pickedIds]),
  })
  const pickedNew = takeWithSourceDiversity(newPool, nNew, opts.sources)

  let picked: PickedProblem[] = [
    ...pickedMistakes.map(p => ({ ...p, pool: 'mistakes' as const })),
    ...pickedNew.map(p => ({ ...p, pool: 'new' as const })),
  ]

  // Фолбэк 1: не хватило — сначала пробуем добрать той же темой, но без
  // окна дедупа (повторяем то, что уже задавалось недавно — хуже, но лучше
  // пустого ДЗ).
  if (picked.length < opts.rule.taskCount) {
    const need = opts.rule.taskCount - picked.length
    const alreadyPicked = new Set(picked.map(p => p.problemId))
    const widerPool = await loadCandidates(admin, {
      libraryTopicId: opts.libraryTopicId,
      sources: opts.sources,
      rule: opts.rule,
      excludeIds: alreadyPicked,
    })
    const extra = takeWithSourceDiversity(widerPool, need, opts.sources)
    if (extra.length > 0) {
      relaxations.push('повторно использованы недавно заданные задачи (не хватило новых)')
      picked = [...picked, ...extra.map(p => ({ ...p, pool: 'new' as const }))]
    }
  }

  // Фолбэк 2: всё ещё не хватает и правило запрещало картинки — пробуем
  // разрешить их, снова той же темой.
  if (picked.length < opts.rule.taskCount && !opts.rule.allowImages) {
    const need = opts.rule.taskCount - picked.length
    const alreadyPicked = new Set(picked.map(p => p.problemId))
    const relaxedRule: RuleConfig = { ...opts.rule, allowImages: true }
    const imagesPool = await loadCandidates(admin, {
      libraryTopicId: opts.libraryTopicId,
      sources: opts.sources,
      rule: relaxedRule,
      excludeIds: alreadyPicked,
    })
    const extra = takeWithSourceDiversity(imagesPool, need, opts.sources)
    if (extra.length > 0) {
      relaxations.push('разрешены задания с картинками (не хватило текстовых)')
      picked = [...picked, ...extra.map(p => ({ ...p, pool: 'new' as const }))]
    }
  }

  const shortfall = picked.length < opts.rule.taskCount * MIN_ACCEPTABLE_RATIO

  return { picked, shortfall, relaxations }
}

/**
 * Из отобранного пула гарантирует минимум 1 задание от каждого источника,
 * разрешённого правилом (если пул вообще что-то даёт по этому источнику),
 * прежде чем добирать остаток пропорционально порядку пула (уже
 * отсортирован по used_count внутри loadCandidates — менее использованные
 * впереди).
 */
function takeWithSourceDiversity(
  pool: CandidateRow[],
  n: number,
  sources: RuleSource[]
): CandidateRow[] {
  if (n <= 0 || pool.length === 0) return []

  const distinctSourceKinds = new Set(sources.map(s => s.sourceKind === 'book' ? 'book' : 'library'))
  const result: CandidateRow[] = []
  const usedIds = new Set<string>()

  if (distinctSourceKinds.size > 1) {
    for (const kind of distinctSourceKinds) {
      if (result.length >= n) break
      const first = pool.find(p => p.source === kind && !usedIds.has(p.problemId))
      if (first) { result.push(first); usedIds.add(first.problemId) }
    }
  }

  for (const p of pool) {
    if (result.length >= n) break
    if (usedIds.has(p.problemId)) continue
    result.push(p)
    usedIds.add(p.problemId)
  }

  return result.slice(0, n)
}

interface CandidateRow {
  source: 'book' | 'library'
  problemId: string
  taskNumber: string | null
  maxScore: number
}

/**
 * Загружает пул задач по теме из всех разрешённых источников правила,
 * применяя фильтры (is_active, require_answer, allow_images, difficulty —
 * только для книг, у библиотеки этого поля нет) и исключая excludeIds.
 * Порядок — по used_count возрастанию (менее использованные задачи вперёд,
 * чтобы одни и те же задачи не залипали в каждом ДЗ подряд).
 */
async function loadCandidates(
  admin: AdminClient,
  opts: {
    libraryTopicId: string
    sources: RuleSource[]
    rule: RuleConfig
    excludeIds: Set<string>
  }
): Promise<CandidateRow[]> {
  const rows: CandidateRow[] = []

  const bookSources = opts.sources.filter(s => s.sourceKind === 'book' && s.bookId)
  for (const src of bookSources) {
    let q = admin
      .from('book_problems')
      .select('id, task_number, correct_answer, is_active, has_images, difficulty')
      .eq('book_id', src.bookId as string)
      .eq('is_active', true)
      .order('used_count', { ascending: true })

    if (opts.rule.requireAnswer) q = q.not('answer_source', 'eq', 'none').not('correct_answer', 'is', null)
    if (!opts.rule.allowImages) q = q.eq('has_images', false)
    if (opts.rule.difficulty !== 'mixed') q = q.eq('difficulty', opts.rule.difficulty)

    // book_problems не хранит тему напрямую — section_id есть, но привязка
    // раздела книги к library_topics не выстроена (см. project_homework_agent,
    // ограничение отмечено в плане: книжные ошибки агрегируются по разделу
    // книги, не по кодификатору). Пока источник типа 'book' не фильтруется
    // по конкретной теме — он либо разрешён правилом целиком, либо нет.
    const { data } = await q
    for (const p of data ?? []) {
      if (opts.excludeIds.has(p.id)) continue
      rows.push({ source: 'book', problemId: p.id, taskNumber: p.task_number, maxScore: computeBookMaxScore(p.correct_answer) })
    }
  }

  const libraryTopicIds = new Set<string>()
  for (const s of opts.sources) {
    if (s.sourceKind === 'library_topic' && s.libraryTopicId === opts.libraryTopicId) libraryTopicIds.add(s.libraryTopicId)
    if (s.sourceKind === 'library_exam') libraryTopicIds.add(opts.libraryTopicId) // тема уже отфильтрована diagnose.ts под этот exam/subject
  }

  if (libraryTopicIds.size > 0) {
    let q = admin
      .from('library_problems')
      .select('id, correct_answer, default_max_score, is_active, has_answer, topic_id, canonical_topic_id, library_problem_media(placement)')
      .or(`topic_id.eq.${opts.libraryTopicId},canonical_topic_id.eq.${opts.libraryTopicId}`)
      .eq('is_active', true)
      .order('used_count', { ascending: true })

    if (opts.rule.requireAnswer) q = q.eq('has_answer', true)
    // difficulty у library_problems нет — фильтр применяется только к книгам

    const { data } = await q
    for (const p of data ?? []) {
      if (opts.excludeIds.has(p.id)) continue
      const media = (p.library_problem_media as { placement: string | null }[] | null) ?? []
      const hasConditionImages = media.some(m => m.placement !== 'solution')
      if (!opts.rule.allowImages && hasConditionImages) continue
      rows.push({ source: 'library', problemId: p.id, taskNumber: null, maxScore: p.default_max_score ?? 1 })
    }
  }

  return rows
}

/** Тот же расчёт, что в lib/tests/add-problem-to-version.ts: composite → число пунктов, иначе 1. */
function computeBookMaxScore(correctAnswer: unknown): number {
  const text =
    correctAnswer !== null && typeof correctAnswer === 'object' && !Array.isArray(correctAnswer)
      ? String((correctAnswer as Record<string, unknown>).text ?? '') || null
      : typeof correctAnswer === 'string' ? correctAnswer : null
  if (!text) return 1
  const composite = buildCompositeAnswerKey(text)
  return composite.isComposite && composite.answerParts ? composite.answerParts.length : 1
}

/**
 * problemId задач, уже задававшихся этим учителем этим ученикам в пределах
 * dedupWindowDays — через assigned_problems (052), обязательно с фильтром
 * teacher_id (вью не org-scoped, под service_role вернёт вообще всех
 * учителей без явного фильтра).
 */
async function loadRecentlyAssignedProblemIds(
  admin: AdminClient,
  teacherId: string,
  studentIds: string[],
  windowDays: number
): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set()

  const { data } = await admin
    .from('assigned_problems')
    .select('problem_id')
    .eq('teacher_id', teacherId)
    .in('student_id', studentIds)
    .gte('assigned_at', new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString())

  const ids = new Set<string>()
  for (const row of data ?? []) {
    if (row.problem_id) ids.add(row.problem_id)
  }
  return ids
}
