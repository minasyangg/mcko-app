// Порт lib/grading/multi-part-answer.ts для скриптов вне Next-сборки (.mjs).
// Логика ДОЛЖНА совпадать с TS-оригиналом — при изменении синхронизировать оба файла.

import { detectGradingMethod } from './answer-heuristics.mjs'

const LABEL_RE = /(?:^|[;,\s])([а-яa-z]|\d{1,2})\)\s*/gi

export function splitAnswerParts(raw) {
  const text = raw.trim()
  if (!text) return null

  const matches = []
  const re = new RegExp(LABEL_RE)
  let m
  while ((m = re.exec(text)) !== null) {
    matches.push({ label: m[1].toLowerCase(), start: m.index, end: re.lastIndex })
    if (m[0].length === 0) re.lastIndex++
  }
  if (matches.length < 2) return null

  const parts = []
  for (let i = 0; i < matches.length; i++) {
    const valueStart = matches[i].end
    const valueEnd = i + 1 < matches.length ? matches[i + 1].start : text.length
    const value = text.slice(valueStart, valueEnd).replace(/[;,\s]+$/, '').trim()
    if (!value) return null
    parts.push({ label: matches[i].label, value })
  }

  const uniqueLabels = new Set(parts.map(p => p.label))
  if (uniqueLabels.size !== parts.length) return null

  return parts
}

const ALGORITHMIC_METHODS = new Set(['normalized', 'numeric_tolerance', 'sequence', 'set_match'])
const NUMERIC_LIKE_METHODS = new Set(['numeric_tolerance', 'sequence', 'set_match'])

export function buildCompositeAnswerKey(raw) {
  const parts = splitAnswerParts(raw)
  if (!parts) return { isComposite: false, correctAnswerJson: raw }

  const methods = parts.map(p => detectGradingMethod(p.value))
  if (!methods.every(m => ALGORITHMIC_METHODS.has(m))) {
    return { isComposite: false, correctAnswerJson: raw }
  }

  const correctAnswerJson = {
    parts: Object.fromEntries(
      parts.map((p, i) => [p.label, { value: p.value, method: methods[i] }])
    ),
  }
  const answerParts = parts.map((p, i) => ({
    label: p.label,
    type: NUMERIC_LIKE_METHODS.has(methods[i]) ? 'numeric' : 'text',
  }))

  return { isComposite: true, correctAnswerJson, answerParts }
}
