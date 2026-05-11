import { normalizeText, normalizeNumeric } from './normalizer'
import type { Json } from '@/types/database'

export interface GradingResult {
  is_correct: boolean
  awarded_score: number
  normalized_answer_json: Json
}

function toObj(j: Json): Record<string, Json | undefined> {
  if (j !== null && typeof j === 'object' && !Array.isArray(j)) {
    return j as Record<string, Json | undefined>
  }
  return {}
}

// Extract the scalar answer string from whatever shape the value has.
// Handles: plain string/number, array, { text }, { value }, { selected }
function extractScalar(j: Json | undefined): string {
  if (j === undefined || j === null) return ''
  if (typeof j === 'string') return j
  if (typeof j === 'number') return String(j)
  if (typeof j === 'boolean') return String(j)
  if (Array.isArray(j)) return j.map(v => toString(v as Json)).join(', ')
  const o = toObj(j as Json)
  if (o['selected'] !== undefined) return toString(o['selected'])
  if (o['text'] !== undefined) return toString(o['text'])
  if (o['value'] !== undefined) return toString(o['value'])
  if (o['parts'] !== undefined && typeof o['parts'] === 'object' && !Array.isArray(o['parts'])) {
    return Object.values(o['parts'] as Record<string, Json>).map(v => toString(v)).join(', ')
  }
  return ''
}

function toString(j: Json | undefined): string {
  if (typeof j === 'string') return j
  if (typeof j === 'number') return String(j)
  if (Array.isArray(j)) return j.map(v => toString(v as Json)).join(', ')
  return ''
}

export function checkAnswer(
  answerJson: Json,
  correctAnswer: Json,
  gradingMethod: string,
  gradingConfig: Json,
  maxScore: number,
  partialScoreRules?: Json | null
): GradingResult {
  const config = toObj(gradingConfig)
  const caseSensitive = config['case_sensitive'] === true

  switch (gradingMethod) {
    case 'exact': {
      const ansText = extractScalar(answerJson)
      const correctText = extractScalar(correctAnswer)
      const normalizedAns = normalizeText(ansText, caseSensitive)
      const normalizedCorrect = normalizeText(correctText, caseSensitive)
      const is_correct = normalizedAns === normalizedCorrect

      return {
        is_correct,
        awarded_score: is_correct ? maxScore : 0,
        normalized_answer_json: ansText,
      }
    }

    case 'normalized': {
      const ansText = extractScalar(answerJson)
      const correctText = extractScalar(correctAnswer)
      const normalizedAns = normalizeText(ansText, caseSensitive)
      const normalizedCorrect = normalizeText(correctText, caseSensitive)
      const is_correct = normalizedAns === normalizedCorrect

      return {
        is_correct,
        awarded_score: is_correct ? maxScore : 0,
        normalized_answer_json: normalizedAns,
      }
    }

    case 'numeric_tolerance': {
      const ansValueStr = extractScalar(answerJson)
      const correctValueStr = extractScalar(correctAnswer)

      const ansNum = normalizeNumeric(ansValueStr)
      const correctNum = normalizeNumeric(correctValueStr)

      const tolerance = typeof config['tolerance'] === 'number' ? config['tolerance'] : 0

      if (ansNum === null || correctNum === null) {
        return {
          is_correct: false,
          awarded_score: 0,
          normalized_answer_json: ansValueStr,
        }
      }

      const is_correct = Math.abs(ansNum - correctNum) <= tolerance

      return {
        is_correct,
        awarded_score: is_correct ? maxScore : 0,
        normalized_answer_json: ansNum,
      }
    }

    case 'set_match': {
      const ans = toObj(answerJson)
      // correct can be plain "1,2,4" or ["1","2","4"] or {selected:[...]}
      const rawCorrect = correctAnswer
      const correctRawSelected: Json[] = Array.isArray(rawCorrect)
        ? rawCorrect
        : typeof rawCorrect === 'string' && rawCorrect.includes(',')
        ? rawCorrect.split(',').map((s) => s.trim())
        : toObj(rawCorrect as Json)['selected'] !== undefined
        ? (Array.isArray(toObj(rawCorrect as Json)['selected'])
            ? (toObj(rawCorrect as Json)['selected'] as Json[])
            : [toObj(rawCorrect as Json)['selected'] as Json])
        : [rawCorrect as Json]

      const ansSelected = Array.isArray(ans['selected'])
        ? (ans['selected'] as Json[]).map((v) => normalizeText(toString(v), caseSensitive))
        : [normalizeText(toString(ans['selected']), caseSensitive)]

      const correctSelected = correctRawSelected.map((v) => normalizeText(toString(v as Json), caseSensitive))

      const correctSet = new Set(correctSelected)
      const matchCount = ansSelected.filter((v) => correctSet.has(v)).length
      const totalCorrect = correctSelected.length
      const is_correct = matchCount === totalCorrect && ansSelected.length === totalCorrect

      let awarded_score = 0
      if (is_correct) {
        awarded_score = maxScore
      } else if (config['partial_credit'] === true && totalCorrect > 0) {
        // Proportional partial credit
        awarded_score = Math.round((matchCount / totalCorrect) * maxScore * 100) / 100

        // Check partial_score_rules if provided
        if (partialScoreRules && Array.isArray(partialScoreRules)) {
          const rules = partialScoreRules as Array<{ min_correct: number; score: number }>
          const sortedRules = [...rules].sort((a, b) => b.min_correct - a.min_correct)
          for (const rule of sortedRules) {
            if (matchCount >= rule.min_correct) {
              awarded_score = rule.score
              break
            }
          }
        }
      }

      return {
        is_correct,
        awarded_score,
        normalized_answer_json: ansSelected,
      }
    }

    case 'contains': {
      const ansText = normalizeText(extractScalar(answerJson), caseSensitive)

      const keywords = Array.isArray(config['keywords'])
        ? (config['keywords'] as Json[]).map((k) => normalizeText(toString(k), caseSensitive))
        : []

      const is_correct = keywords.length > 0 && keywords.every((kw) => ansText.includes(kw))

      return {
        is_correct,
        awarded_score: is_correct ? maxScore : 0,
        normalized_answer_json: ansText,
      }
    }

    case 'regex': {
      const ansText = extractScalar(answerJson)
      const pattern = typeof config['pattern'] === 'string' ? config['pattern'] : ''

      let is_correct = false
      try {
        const flags = caseSensitive ? '' : 'i'
        const re = new RegExp(pattern, flags)
        is_correct = re.test(ansText)
      } catch {
        is_correct = false
      }

      return {
        is_correct,
        awarded_score: is_correct ? maxScore : 0,
        normalized_answer_json: ansText,
      }
    }

    case 'manual':
    default: {
      return {
        is_correct: false,
        awarded_score: 0,
        normalized_answer_json: answerJson,
      }
    }
  }
}
