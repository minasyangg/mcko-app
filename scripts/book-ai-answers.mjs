// Массовая ИИ-генерация эталонных ответов для заданий книги без ответа
// (answer_source='none'). Решает через Anthropic API (Claude), сохраняет
// correct_answer + grading_method + answer_source='ai' сервис-роулом.
// Запускается ЛОКАЛЬНО после импорта книги (паттерн book-import.mjs).
//
// node scripts/book-ai-answers.mjs --book <uuid> [--dry-run] [--limit N]
//   [--model claude-sonnet-5|claude-haiku-4-5] [--concurrency 3]
//
// env (или .env.import.local): SUPABASE_URL (или NEXT_PUBLIC_SUPABASE_URL),
//   SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY

import fs from 'node:fs'

// ── env / args ───────────────────────────────────────────────────────────────

function loadEnv() {
  for (const f of ['.env.import.local', '.env.local', '.env.development.local']) {
    if (!fs.existsSync(f)) continue
    for (const line of fs.readFileSync(f, 'utf-8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  }
}
loadEnv()

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i !== -1 && args[i + 1] ? args[i + 1] : null
}

const bookId = flag('--book')
const dryRun = args.includes('--dry-run')
const limit = parseInt(flag('--limit') ?? '0') || 0
const model = flag('--model') ?? 'claude-sonnet-5'
const concurrency = Math.max(1, parseInt(flag('--concurrency') ?? '3') || 3)

if (!bookId) {
  console.error('Usage: node scripts/book-ai-answers.mjs --book <uuid> [--dry-run] [--limit N] [--model ...] [--concurrency N]')
  process.exit(1)
}

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anthropicKey = process.env.ANTHROPIC_API_KEY
if (!supabaseUrl || !serviceKey) {
  console.error('Нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (env или .env.import.local).')
  process.exit(1)
}
if (!anthropicKey) {
  console.error('Нет ANTHROPIC_API_KEY (env или .env.import.local).')
  process.exit(1)
}

// ── Эвристики классификации ответа ──────────────────────────────────────────
// Копия lib/grading/answer-heuristics.ts (импорт TS из .mjs невозможен —
// прецедент дублирования: assignAnswer в book-import.mjs). При изменении
// логики синхронизировать оба файла.

const EXPLANATION_KEYWORDS = /поясни|объясни|докажи|обоснуй|опиши|сформулируй|охарактеризуй|сравни|проанализируй|ответ\s+поясните|ответ\s+объясните/i

function requiresExplanation(promptText) {
  return EXPLANATION_KEYWORDS.test(promptText)
}

function cleanParsedAnswer(raw) {
  return raw.trim()
    .replace(/[.;:]+$/, '')
    .replace(/([-–−])\s+(\d)/g, '$1$2')
    .trim()
}

function detectGradingMethod(rawAnswer) {
  const cleaned = cleanParsedAnswer(rawAnswer).trim()
  const lower = cleaned.toLowerCase()

  if (/см\.?\s*рис|по\s+рисунку|на\s+рисунке|на\s+графике/.test(lower)) return 'manual'
  if (/\d+\)[\s\S]+\d+\)/.test(cleaned)) return 'manual'
  if (/[а-е]\)[\s\S]+[а-е]\)/.test(lower)) return 'manual'
  if (cleaned.startsWith('$') || /\\frac|\\sqrt/.test(cleaned)) return 'manual'

  const firstAlt = cleaned.split(/\s+или\s+/i)[0].trim()

  if (/^[А-Еа-е]-\d/.test(firstAlt)) return 'sequence'
  if (/^[-–−]?\d+([,.]?\d+)?(\s+[а-яa-zёА-ЯA-Z\/²³°%·]+\.?)*$/.test(firstAlt)) return 'numeric_tolerance'
  if (/^\d{2,6}$/.test(cleaned) && !cleaned.startsWith('0')) return 'set_match'
  if (/^\d+(,\s*\d+)+$/.test(cleaned)) return 'set_match'

  return 'normalized'
}

// ── Anthropic ────────────────────────────────────────────────────────────────

const { default: Anthropic } = await import('@anthropic-ai/sdk')
const anthropic = new Anthropic({ apiKey: anthropicKey })

const SYSTEM_PROMPT = `Ты опытный школьный учитель. Тебе дают задание из учебника (5–11 класс). Реши его и дай ТОЛЬКО итоговый ответ.

Правила ответа:
- Формулы в условии записаны в LaTeX ($...$). Свой ответ давай БЕЗ LaTeX, простым текстом: дроби — десятичной дробью (4.5) или в виде a/b, степени — символами (x²).
- Если в задании подпункты а) б) в) — ответ в формате "а) ...; б) ...; в) ...".
- Не пиши ход решения в поле answer — только итог.
- Если не уверен в решении или задание требует рисунка/построения/измерений — can_solve: false.`

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    can_solve: { type: 'boolean' },
    answer: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    solution_brief: { type: 'string' },
  },
  required: ['can_solve', 'answer', 'confidence', 'solution_brief'],
  additionalProperties: false,
}

// у claude-sonnet-5 нельзя передавать temperature (400); thinking по умолчанию
// адаптивный — для многошаговой математики это то, что нужно
async function solveProblem(promptMd, bookContext) {
  const response = await anthropic.messages.create({
    model,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: ANSWER_SCHEMA } },
    messages: [{
      role: 'user',
      content: `${bookContext}\n\nЗадание:\n${promptMd.slice(0, 6000)}`,
    }],
  })

  const usage = {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
  }

  if (response.stop_reason === 'refusal') return { result: null, usage }
  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock?.text) return { result: null, usage }

  let parsed
  try { parsed = JSON.parse(textBlock.text) } catch { return { result: null, usage } }

  if (!parsed.can_solve || parsed.confidence === 'low') return { result: null, usage, lowConfidence: true }
  const raw = (parsed.answer ?? '').trim()
  if (!raw || raw.length > 800) return { result: null, usage }

  const answerText = cleanParsedAnswer(raw)
  if (!answerText) return { result: null, usage }

  const gradingMethod = requiresExplanation(promptMd) ? 'manual' : detectGradingMethod(answerText)
  return { result: { answerText, gradingMethod, confidence: parsed.confidence, brief: parsed.solution_brief }, usage }
}

// ── Supabase ─────────────────────────────────────────────────────────────────

const { createClient } = await import('@supabase/supabase-js')
const db = createClient(supabaseUrl, serviceKey)

const { data: book, error: bookErr } = await db
  .from('books')
  .select('id, title, subject, grade, level')
  .eq('id', bookId)
  .single()
if (bookErr || !book) {
  console.error('Книга не найдена:', bookErr?.message ?? bookId)
  process.exit(1)
}

console.log(`📖 ${book.title} (${book.subject}${book.grade ? `, ${book.grade} класс` : ''})`)
console.log(`🤖 Модель: ${model}${dryRun ? ' · DRY RUN (без записи)' : ''}\n`)

const bookContext = `Учебник: ${book.title}. Предмет: ${book.subject}${book.grade ? `, ${book.grade} класс` : ''}${book.level ? `, уровень: ${book.level}` : ''}.`

let query = db
  .from('book_problems')
  .select('id, task_number, prompt_md, has_images')
  .eq('book_id', bookId)
  .eq('answer_source', 'none')
  .is('correct_answer', null)
  .eq('is_active', true)
  .order('task_number_sort', { ascending: true, nullsFirst: false })
if (limit > 0) query = query.limit(limit * 2) // запас: часть отсеется по картинкам

const { data: problems, error: probErr } = await query
if (probErr) {
  console.error('Ошибка выборки заданий:', probErr.message)
  process.exit(1)
}

const withImages = (problems ?? []).filter((p) => p.has_images)
let queue = (problems ?? []).filter((p) => !p.has_images)
if (limit > 0) queue = queue.slice(0, limit)

console.log(`Заданий без ответа: ${(problems ?? []).length}, из них с картинками (скип): ${withImages.length}, в работу: ${queue.length}\n`)
if (queue.length === 0) process.exit(0)

// ── Пул воркеров ─────────────────────────────────────────────────────────────

const stats = { solved: 0, lowConf: 0, failed: 0, raced: 0, inTokens: 0, outTokens: 0 }
const results = []
let cursor = 0

async function worker() {
  while (cursor < queue.length) {
    const p = queue[cursor++]
    try {
      const { result, usage, lowConfidence } = await solveProblem(p.prompt_md, bookContext)
      stats.inTokens += usage.input
      stats.outTokens += usage.output

      if (!result) {
        if (lowConfidence) stats.lowConf++
        else stats.failed++
        console.log(`  ✗ №${p.task_number}: ${lowConfidence ? 'низкая уверенность' : 'не решено'}`)
        continue
      }

      results.push({ task_number: p.task_number, ...result })

      if (!dryRun) {
        const { data: updated, error: updErr } = await db
          .from('book_problems')
          .update({
            correct_answer: { text: result.answerText },
            grading_method: result.gradingMethod,
            answer_source: 'ai',
            updated_at: new Date().toISOString(),
          })
          .eq('id', p.id)
          .eq('answer_source', 'none') // защита от параллельной ручной правки
          .select('id')
        if (updErr) {
          stats.failed++
          console.log(`  ✗ №${p.task_number}: запись — ${updErr.message}`)
          continue
        }
        if (!updated?.length) {
          stats.raced++
          console.log(`  ⚠ №${p.task_number}: ответ появился параллельно — пропуск`)
          continue
        }
      }

      stats.solved++
      console.log(`  ✓ №${p.task_number} [${result.confidence}] ${result.gradingMethod}: ${result.answerText.slice(0, 80)}`)
    } catch (e) {
      stats.failed++
      console.log(`  ✗ №${p.task_number}: ${e.message}`)
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()))

// ── Отчёт ────────────────────────────────────────────────────────────────────

// claude-sonnet-5: $3/MTok input, $15/MTok output (intro $2/$10 до 31.08.2026)
const cost = (stats.inTokens * 3 + stats.outTokens * 15) / 1_000_000

console.log(`\n${'─'.repeat(60)}`)
console.log(`✅ Решено${dryRun ? ' (dry-run, БЕЗ записи)' : ''}: ${stats.solved}`)
console.log(`   Низкая уверенность (не записано): ${stats.lowConf}`)
console.log(`   Не решено/ошибки: ${stats.failed}`)
if (stats.raced) console.log(`   Пропущено (гонка с ручной правкой): ${stats.raced}`)
console.log(`   Скип (картинки): ${withImages.length}`)
console.log(`   Токены: ${stats.inTokens} in / ${stats.outTokens} out ≈ $${cost.toFixed(2)}`)

if (dryRun && results.length) {
  console.log('\nПредпросмотр (dry-run):')
  for (const r of results) {
    console.log(`  №${r.task_number} [${r.confidence}] ${r.gradingMethod}: ${r.answerText}`)
  }
}
