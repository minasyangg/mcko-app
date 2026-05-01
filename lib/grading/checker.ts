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

function toString(j: Json | undefined): string {
  if (typeof j === 'string') return j
  if (typeof j === 'number') return String(j)
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
      const ans = toObj(answerJson)
      const correct = toObj(correctAnswer)

      // Determine actual value strings based on answer shape
      const ansText = ans['selected'] !== undefined
        ? toString(ans['selected'])
        : ans['text'] !== undefined
        ? toString(ans['text'])
        : ans['value'] !== undefined
        ? toString(ans['value'])
        : ''

      const correctText = correct['selected'] !== undefined
        ? toString(correct['selected'])
        : correct['text'] !== undefined
        ? toString(correct['text'])
        : correct['value'] !== undefined
        ? toString(correct['value'])
        : ''

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
      const ans = toObj(answerJson)
      const correct = toObj(correctAnswer)

      const ansText = ans['text'] !== undefined
        ? toString(ans['text'])
        : ans['selected'] !== undefined
        ? toString(ans['selected'])
        : toString(ans['value'])

      const correctText = correct['text'] !== undefined
        ? toString(correct['text'])
        : correct['selected'] !== undefined
        ? toString(correct['selected'])
        : toString(correct['value'])

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
      const ans = toObj(answerJson)
      const correct = toObj(correctAnswer)

      const ansValueStr = toString(ans['value'] ?? ans['text'])
      const correctValueStr = toString(correct['value'] ?? correct['text'])

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
      const correct = toObj(correctAnswer)

      const ansSelected = Array.isArray(ans['selected'])
        ? (ans['selected'] as Json[]).map((v) => normalizeText(toString(v), caseSensitive))
        : [normalizeText(toString(ans['selected']), caseSensitive)]

      const correctSelected = Array.isArray(correct['selected'])
        ? (correct['selected'] as Json[]).map((v) => normalizeText(toString(v), caseSensitive))
        : [normalizeText(toString(correct['selected']), caseSensitive)]

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
      const ans = toObj(answerJson)
      const ansText = normalizeText(toString(ans['text'] ?? ans['value'] ?? ans['selected']), caseSensitive)

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
      const ans = toObj(answerJson)
      const ansText = toString(ans['text'] ?? ans['value'] ?? ans['selected'])
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
