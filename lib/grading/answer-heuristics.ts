// Эвристики классификации ответов: по форме эталонного ответа определяют
// метод авто-проверки и подсказку формата для ученика. Используются парсингом
// PDF (app/api/parsing/trigger) и ИИ-генерацией ответов (lib/ai/*).

// Слова в условии, требующие свободного объяснения → всегда manual/ИИ-проверка
const EXPLANATION_KEYWORDS = /поясни|объясни|докажи|обоснуй|опиши|сформулируй|охарактеризуй|сравни|проанализируй|ответ\s+поясните|ответ\s+объясните/i

export function requiresExplanation(promptText: string): boolean {
  return EXPLANATION_KEYWORDS.test(promptText)
}

export function cleanParsedAnswer(raw: string): string {
  return raw.trim()
    .replace(/[.;:]+$/, '')
    .replace(/([-–−])\s+(\d)/g, '$1$2') // "- 7" → "-7"
    .trim()
}

export function detectGradingMethod(rawAnswer: string): string {
  const cleaned = cleanParsedAnswer(rawAnswer).trim()
  const lower = cleaned.toLowerCase()

  // Image-based → manual
  if (/см\.?\s*рис|по\s+рисунку|на\s+рисунке|на\s+графике/.test(lower)) return 'manual'
  // Multi-part "1) ... 2) ..." или книжные подпункты "а) ... б) ..." → manual
  // (составные ответы сравниваются по смыслу через checkWithAI, не строково)
  if (/\d+\)[\s\S]+\d+\)/.test(cleaned)) return 'manual'
  if (/[а-е]\)[\s\S]+[а-е]\)/.test(lower)) return 'manual'
  // LaTeX formula → manual
  if (cleaned.startsWith('$') || /\\frac|\\sqrt/.test(cleaned)) return 'manual'

  // Strip "или" alternatives for detection
  const firstAlt = cleaned.split(/\s+или\s+/i)[0].trim()

  // Letter-digit correspondence "А-3, Б-1" → sequence
  if (/^[А-Еа-е]-\d/.test(firstAlt)) return 'sequence'

  // Обыкновенная/смешанная дробь "1/2", "2 1/3" — тоже числовой ответ
  // (lib/grading/normalizer.ts умеет разбирать обе формы)
  if (/^-?\d+(\s+\d+)?\/\d+$/.test(firstAlt)) return 'numeric_tolerance'

  // Pure numeric (int/decimal, optional negative, optional units after space)
  if (/^[-–−]?\d+([,.]?\d+)?(\s+[а-яa-zёА-ЯA-Z\/²³°%·]+\.?)*$/.test(firstAlt)) {
    return 'numeric_tolerance'
  }

  // Digit sequence 2-6 digits (multiple choice items concatenated, e.g. "124", "35")
  if (/^\d{2,6}$/.test(cleaned) && !cleaned.startsWith('0')) return 'set_match'

  // Comma-separated small numbers "1, 4" "2,4,5" → set_match
  if (/^\d+(,\s*\d+)+$/.test(cleaned)) return 'set_match'

  return 'normalized'
}

export function buildFormatHint(rawAnswer: string, method: string): string | null {
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
