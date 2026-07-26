// Порт lib/grading/answer-heuristics.ts для скриптов вне Next-сборки (.mjs,
// без TS). Логика ДОЛЖНА совпадать с TS-оригиналом — при изменении одного
// файла синхронизировать другой (используется и online ИИ-генерацией через
// DeepSeek, и офлайн-инструментами вроде scripts/classify-answer.mjs).

const EXPLANATION_KEYWORDS = /поясни|объясни|докажи|обоснуй|опиши|сформулируй|охарактеризуй|сравни|проанализируй|ответ\s+поясните|ответ\s+объясните/i

export function requiresExplanation(promptText) {
  return EXPLANATION_KEYWORDS.test(promptText)
}

export function cleanParsedAnswer(raw) {
  return raw.trim()
    .replace(/[.;:]+$/, '')
    .replace(/([-–−])\s+(\d)/g, '$1$2') // "- 7" → "-7"
    .trim()
}

export function detectGradingMethod(rawAnswer) {
  const cleaned = cleanParsedAnswer(rawAnswer).trim()
  const lower = cleaned.toLowerCase()

  if (/см\.?\s*рис|по\s+рисунку|на\s+рисунке|на\s+графике/.test(lower)) return 'manual'
  if (/\d+\)[\s\S]+\d+\)/.test(cleaned)) return 'manual'
  if (/[а-е]\)[\s\S]+[а-е]\)/.test(lower)) return 'manual'
  if (cleaned.startsWith('$') || /\\frac|\\sqrt/.test(cleaned)) return 'manual'

  const firstAlt = cleaned.split(/\s+или\s+/i)[0].trim()

  if (/^[А-Еа-е]-\d/.test(firstAlt)) return 'sequence'
  // Обыкновенная/смешанная дробь "1/2", "2 1/3" — тоже числовой ответ
  if (/^-?\d+(\s+\d+)?\/\d+$/.test(firstAlt)) return 'numeric_tolerance'
  if (/^[-–−]?\d+([,.]?\d+)?(\s+[а-яa-zёА-ЯA-Z\/²³°%·]+\.?)*$/.test(firstAlt)) return 'numeric_tolerance'
  if (/^\d{2,6}$/.test(cleaned) && !cleaned.startsWith('0')) return 'set_match'
  if (/^\d+(,\s*\d+)+$/.test(cleaned)) return 'set_match'

  return 'normalized'
}

export function buildFormatHint(rawAnswer, method) {
  const cleaned = cleanParsedAnswer(rawAnswer)
  switch (method) {
    case 'numeric_tolerance':
      if (/[,.]/.test(cleaned.replace(/\s.*$/, ''))) {
        return 'Запишите число через точку или запятую, например: 4.5 (можно и 4,5)'
      }
      return 'Запишите целое число, например: 42'
    case 'sequence':
      return 'Запишите цифры подряд по порядку букв (А, Б, В…), например: 312'
    case 'set_match':
      return 'Запишите номера правильных ответов подряд без пробелов, например: 124'
    default:
      return null
  }
}
