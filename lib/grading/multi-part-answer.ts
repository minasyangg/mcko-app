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

// Пытается превратить сырую строку эталонного ответа в составной,
// проверяемый по частям. Если хоть одна часть требует ручной/ИИ-проверки —
// возвращает isComposite:false и raw как есть (сегодняшнее поведение,
// без изменений).
export function buildCompositeAnswerKey(raw: string): CompositeAnswerKeyResult {
  const parts = splitAnswerParts(raw)
  if (!parts) return { isComposite: false, correctAnswerJson: raw }

  const methods = parts.map(p => detectGradingMethod(p.value))
  if (!methods.every(m => ALGORITHMIC_METHODS.has(m))) {
    return { isComposite: false, correctAnswerJson: raw }
  }

  const correctAnswerJson: Json = {
    parts: Object.fromEntries(
      parts.map((p, i) => [p.label, { value: p.value, method: methods[i] }])
    ),
  }
  const answerParts: Json[] = parts.map((p, i): Json => ({
    label: p.label,
    type: NUMERIC_LIKE_METHODS.has(methods[i]) ? 'numeric' : 'text',
  }))

  return { isComposite: true, correctAnswerJson, answerParts }
}
