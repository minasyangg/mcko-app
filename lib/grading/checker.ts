import { normalizeText, normalizeNumeric, extractNumericValue, splitAlternatives } from './normalizer'
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

// Extract scalar string from any answer shape: plain value, {text}, {value}, {selected}, {parts}
function extractScalar(j: Json | undefined): string {
  if (j === undefined || j === null) return ''
  if (typeof j === 'string') return j
  if (typeof j === 'number') return String(j)
  if (typeof j === 'boolean') return String(j)
  if (Array.isArray(j)) return j.map(v => scalarToString(v as Json)).join(', ')
  const o = toObj(j as Json)
  if (o['selected'] !== undefined) return scalarToString(o['selected'])
  if (o['text'] !== undefined) return scalarToString(o['text'])
  if (o['value'] !== undefined) return scalarToString(o['value'])
  if (o['parts'] !== undefined && typeof o['parts'] === 'object' && !Array.isArray(o['parts'])) {
    return Object.values(o['parts'] as Record<string, Json>).map(v => scalarToString(v)).join(', ')
  }
  return ''
}

function scalarToString(j: Json | undefined): string {
  if (typeof j === 'string') return j
  if (typeof j === 'number') return String(j)
  if (Array.isArray(j)) return j.map(v => scalarToString(v as Json)).join(', ')
  return ''
}

// Normalize a sequence answer: "А-3,Б-1,В-2" or "3 1 2" or "312" → ["3","1","2"]
function normalizeSequence(s: string): string[] {
  // Remove any letter-dash prefix ("А-", "Б-", "Ж-", "A-", etc.)
  const withoutPrefixes = s.replace(/[А-Яа-яA-Za-z]-/g, ' ')
  // Extract all numeric tokens
  const tokens = withoutPrefixes.match(/\d+/g) ?? []
  if (tokens.length === 1 && tokens[0].length > 1) {
    // "312" → single multi-digit token → split into individual digits
    return tokens[0].split('')
  }
  return tokens
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
    case 'normalized': {
      const ansText = extractScalar(answerJson)
      const correctText = extractScalar(correctAnswer)
      const normalizedAns = normalizeText(ansText, caseSensitive)
      // Support "или" alternatives in correct answer
      const alternatives = splitAlternatives(correctText)
      const is_correct = alternatives.some(alt => normalizedAns === normalizeText(alt, caseSensitive))
      return {
        is_correct,
        awarded_score: is_correct ? maxScore : 0,
        normalized_answer_json: normalizedAns,
      }
    }

    case 'numeric_tolerance': {
      const studentStr = extractScalar(answerJson)
      const correctStr = extractScalar(correctAnswer)
      const tolerance = typeof config['tolerance'] === 'number' ? config['tolerance'] : 0

      // Support "или" alternatives (e.g. "–1012 или –1210")
      const alternatives = splitAlternatives(correctStr)

      for (const alt of alternatives) {
        // Strip units before numeric comparison ("19 км/ч" → "19")
        const studentNum = normalizeNumeric(extractNumericValue(studentStr) ?? studentStr)
        const correctNum = normalizeNumeric(extractNumericValue(alt) ?? alt)

        if (studentNum !== null && correctNum !== null) {
          if (Math.abs(studentNum - correctNum) <= tolerance) {
            return { is_correct: true, awarded_score: maxScore, normalized_answer_json: studentNum }
          }
        } else {
          // Fallback: text comparison (handles non-numeric like "π", "-")
          if (normalizeText(studentStr) === normalizeText(alt)) {
            return { is_correct: true, awarded_score: maxScore, normalized_answer_json: normalizeText(studentStr) }
          }
        }
      }

      // Compute normalized student value for display
      const displayNum = normalizeNumeric(extractNumericValue(studentStr) ?? studentStr)
      return {
        is_correct: false,
        awarded_score: 0,
        normalized_answer_json: displayNum ?? normalizeText(studentStr),
      }
    }

    case 'sequence': {
      // Matching tasks: "А→3, Б→1, В→2" answer is "312" or "А-3,Б-1,В-2"
      const studentStr = extractScalar(answerJson)
      const correctStr = extractScalar(correctAnswer)
      const studentSeq = normalizeSequence(studentStr)
      const correctSeq = normalizeSequence(correctStr)
      const is_correct = studentSeq.length > 0 &&
        studentSeq.length === correctSeq.length &&
        studentSeq.every((v, i) => v === correctSeq[i])
      return {
        is_correct,
        awarded_score: is_correct ? maxScore : 0,
        normalized_answer_json: studentSeq,
      }
    }

    case 'set_match': {
      const ans = toObj(answerJson)
      const rawCorrect = correctAnswer
      // Correct answer can be: "1,2,4" | ["1","2","4"] | {selected:[...]} | plain string
      const rawCorrectObj = toObj(rawCorrect as Json)
      const correctRawSelected: Json[] = Array.isArray(rawCorrect)
        ? rawCorrect
        : typeof rawCorrect === 'string' && /,/.test(rawCorrect)
        ? rawCorrect.split(',').map((s) => s.trim())
        : rawCorrectObj['selected'] !== undefined
        ? (Array.isArray(rawCorrectObj['selected'])
            ? (rawCorrectObj['selected'] as Json[])
            : [rawCorrectObj['selected'] as Json])
        : typeof rawCorrect === 'string' && rawCorrect.length > 1 && /^\d+$/.test(rawCorrect)
        ? rawCorrect.split('').map(d => d) // "124" → ["1","2","4"]
        : [rawCorrect as Json]

      // Student answer: from {selected: [...]} or extract from text ("124" → ["1","2","4"])
      let ansSelected: string[]
      if (Array.isArray(ans['selected'])) {
        ansSelected = (ans['selected'] as Json[]).map((v) => normalizeText(scalarToString(v), caseSensitive))
      } else if (typeof ans['text'] === 'string' && /^\d+$/.test(ans['text'] as string)) {
        ansSelected = (ans['text'] as string).split('').map(d => d)
      } else {
        ansSelected = [normalizeText(scalarToString(ans['selected']), caseSensitive)]
      }

      const correctSelected = correctRawSelected.map((v) => normalizeText(scalarToString(v as Json), caseSensitive))
      const correctSet = new Set(correctSelected)
      const matchCount = ansSelected.filter((v) => correctSet.has(v)).length
      const totalCorrect = correctSelected.length
      const is_correct = matchCount === totalCorrect && ansSelected.length === totalCorrect

      let awarded_score = 0
      if (is_correct) {
        awarded_score = maxScore
      } else if (config['partial_credit'] === true && totalCorrect > 0) {
        awarded_score = Math.round((matchCount / totalCorrect) * maxScore * 100) / 100
        if (partialScoreRules && Array.isArray(partialScoreRules)) {
          const rules = partialScoreRules as Array<{ min_correct: number; score: number }>
          const sortedRules = [...rules].sort((a, b) => b.min_correct - a.min_correct)
          for (const rule of sortedRules) {
            if (matchCount >= rule.min_correct) { awarded_score = rule.score; break }
          }
        }
      }
      return { is_correct, awarded_score, normalized_answer_json: ansSelected }
    }

    case 'contains': {
      const ansText = normalizeText(extractScalar(answerJson), caseSensitive)
      const keywords = Array.isArray(config['keywords'])
        ? (config['keywords'] as Json[]).map((k) => normalizeText(scalarToString(k), caseSensitive))
        : []
      const is_correct = keywords.length > 0 && keywords.every((kw) => ansText.includes(kw))
      return { is_correct, awarded_score: is_correct ? maxScore : 0, normalized_answer_json: ansText }
    }

    case 'regex': {
      const ansText = extractScalar(answerJson)
      const pattern = typeof config['pattern'] === 'string' ? config['pattern'] : ''
      let is_correct = false
      try {
        const flags = caseSensitive ? '' : 'i'
        is_correct = new RegExp(pattern, flags).test(ansText)
      } catch { is_correct = false }
      return { is_correct, awarded_score: is_correct ? maxScore : 0, normalized_answer_json: ansText }
    }

    case 'manual':
    default: {
      return { is_correct: false, awarded_score: 0, normalized_answer_json: answerJson }
    }
  }
}
