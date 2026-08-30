import type { Json } from '@/types/database'
import { detectGradingMethod } from './answer-heuristics'

export interface AnswerPart {
  label: string
  value: string
}

// Метки составного ответа: «а)», «б)» (кириллица), «a)», «b)» (латиница),
// «1)», «2)» (цифры). Разделитель перед меткой (кроме самой первой в строке)
// обязателен — иначе "23)" внутри обычного числа ложно распознавалось бы
// как метка "3)".
const LABEL_RE = /(?:^|[;,\s])([а-яa-z]|\d{1,2})\)\s*/gi

// Разбивает эталонный ответ на пронумерованные/пролитерованные части.
// Возвращает null, если меток меньше двух — намеренно НЕ разбиваем ответы
// без явных меток (просто через ";"/перенос строки): риск располовинить
// обычный текстовый ответ или список альтернатив выше пользы.
export function splitAnswerParts(raw: string): AnswerPart[] | null {
  const text = raw.trim()
  if (!text) return null

  const matches: { label: string; start: number; end: number }[] = []
  const re = new RegExp(LABEL_RE)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    matches.push({ label: m[1].toLowerCase(), start: m.index, end: re.lastIndex })
    if (m[0].length === 0) re.lastIndex++
  }
  if (matches.length < 2) return null

  const parts: AnswerPart[] = []
  for (let i = 0; i < matches.length; i++) {
    const valueStart = matches[i].end
    const valueEnd = i + 1 < matches.length ? matches[i + 1].start : text.length
    const value = text.slice(valueStart, valueEnd).replace(/[;,\s]+$/, '').trim()
    if (!value) return null // пустая часть — не похоже на честный составной ответ
    parts.push({ label: matches[i].label, value })
  }

  // Метки должны быть уникальны (иначе это, скорее всего, не список
  // подпунктов, а случайное совпадение вида "число)" внутри текста)
  const uniqueLabels = new Set(parts.map(p => p.label))
  if (uniqueLabels.size !== parts.length) return null

  return parts
}

export interface CompositeAnswerPart {
  label: string
  type: 'text' | 'numeric'
}

export interface CompositeAnswerKeyResult {
  isComposite: boolean
  correctAnswerJson: Json
  // Json на границе (колонка test_tasks.answer_parts — jsonb); по форме
  // это всегда CompositeAnswerPart[].
  answerParts?: Json[]
}

// Методы, которые может проверить checkSingleValue без участия ИИ/учителя.
const ALGORITHMIC_METHODS = new Set(['normalized', 'numeric_tolerance', 'sequence', 'set_match'])
const NUMERIC_LIKE_METHODS = new Set(['numeric_tolerance', 'sequence', 'set_match'])

// Превращает LaTeX-дробь внутри значения части в обычную запись, которую
// понимает числовой парсер (normalizeNumeric/extractNumericValue):
// "$\frac{1}{3}$" → "1/3", "18 $\frac{1}{3}$" → "18 1/3" (уже смешанное
// число), "$43\frac{1}{3}$" (без пробела — обычная запись смешанного числа в
// LaTeX) → "43 1/3". Первым идёт паттерн «цифра вплотную перед \frac» — иначе
// общий паттерн просто вклеил бы "1/3" сразу за "43" без пробела ("431/3").
// Если после замены остаются `\`/`{`/`}` (сложные конструкции — \sqrt,
// вложенные дроби, степени) — их не трогаем, detectGradingMethod ниже по
// прежнему правилу отправит такое на ручную проверку.
function latexFractionToPlain(s: string): string {
  return s
    .replace(/(-?\d+)\\frac\s*\{\s*(-?\d+)\s*\}\s*\{\s*(\d+)\s*\}/g, '$1 $2/$3')
    .replace(/\\frac\s*\{\s*(-?\d+)\s*\}\s*\{\s*(\d+)\s*\}/g, '$1/$2')
    .replace(/\$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Пытается превратить сырую строку эталонного ответа в составной,
// проверяемый по частям. Если хоть одна часть требует ручной/ИИ-проверки —
// возвращает isComposite:false и raw как есть (сегодняшнее поведение,
// без изменений).
export function buildCompositeAnswerKey(raw: string): CompositeAnswerKeyResult {
  const parts = splitAnswerParts(raw)
  if (!parts) return { isComposite: false, correctAnswerJson: raw }

  // Значение части приводим к виду без LaTeX-дробей ДО классификации и
  // используем этот же вид как хранимое значение — иначе detectGradingMethod
  // увидел бы уже чистую запись, а фактическое сравнение при проверке
  // получило бы обратно "$\frac{1}{3}$" и не распознало бы число.
  const cleanedValues = parts.map(p => latexFractionToPlain(p.value))
  const methods = cleanedValues.map(v => detectGradingMethod(v))
  if (!methods.every(m => ALGORITHMIC_METHODS.has(m))) {
    return { isComposite: false, correctAnswerJson: raw }
  }

  const correctAnswerJson: Json = {
    parts: Object.fromEntries(
      parts.map((p, i) => [p.label, { value: cleanedValues[i], method: methods[i] }])
    ),
  }
  const answerParts: Json[] = parts.map((p, i): Json => ({
    label: p.label,
    type: NUMERIC_LIKE_METHODS.has(methods[i]) ? 'numeric' : 'text',
  }))

  return { isComposite: true, correctAnswerJson, answerParts }
}

// Обратное преобразование к buildCompositeAnswerKey — восстанавливает
// редактируемую строку «а) значение; б) значение» из {parts:{...}}, чтобы
// форма редактирования (простое текстовое поле) могла отдать её обратно в
// buildCompositeAnswerKey без потери составной структуры при пересохранении
// без изменений. Для не-составных форм (plain text/{text:...}) — просто
// человекочитаемый текст, здесь не нужен (см. formatAnswerJson).
export function formatCompositeAnswerForEdit(json: Json): string | null {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null
  const obj = json as Record<string, Json | undefined>
  if (!('parts' in obj) || obj['parts'] === null || typeof obj['parts'] !== 'object' || Array.isArray(obj['parts'])) {
    return null
  }
  const parts = obj['parts'] as Record<string, Json | undefined>
  return Object.entries(parts)
    .map(([label, entry]) => {
      const value = entry !== null && typeof entry === 'object' && !Array.isArray(entry) && 'value' in entry
        ? (entry as Record<string, Json | undefined>)['value']
        : entry
      return `${label}) ${typeof value === 'string' ? value : JSON.stringify(value ?? '')}`
    })
    .join('; ')
}
