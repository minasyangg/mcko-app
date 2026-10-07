export function normalizeText(value: string, caseSensitive = false): string {
  let s = value.trim()
    .replace(/\s+/g, ' ')
    .replace(/,/g, '.')
    .replace(/[.;:!?\s]+$/, '') // strip trailing punctuation ("4,5." → "4.5")
  if (!caseSensitive) s = s.toLowerCase()
  return s
}

export function normalizeNumeric(value: string): number | null {
  const trimmed = value.trim().replace(/,/g, '.')

  // Смешанное число: "2 1/3" → 2 + 1/3. Пробел между целой частью и дробью
  // значим — схлопывать пробелы до проверки нельзя, иначе "2 1/3" → "21/3".
  const mixedMatch = trimmed.match(/^(-?)(\d+)\s+(\d+)\/(\d+)$/)
  if (mixedMatch) {
    const sign = mixedMatch[1] === '-' ? -1 : 1
    const whole = parseFloat(mixedMatch[2])
    const num = parseFloat(mixedMatch[3])
    const den = parseFloat(mixedMatch[4])
    return den !== 0 ? sign * (whole + num / den) : null
  }

  const s = trimmed.replace(/[\s ]/g, '')
  // Простая дробь: "5/2" → 2.5, "1/4" → 0.25
  const fracMatch = s.match(/^(-?\d+)\/(\d+)$/)
  if (fracMatch) {
    const num = parseFloat(fracMatch[1])
    const den = parseFloat(fracMatch[2])
    return den !== 0 ? num / den : null
  }
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

// Extract leading numeric value, discarding units ("19 км/ч" → "19", "4,5 м/с" → "4.5").
// Дробь/смешанное число ("1/2", "2 1/3") распознаются целиком — раньше строка
// обрывалась на первом "/", теряя знаменатель до того, как normalizeNumeric
// успевал его разобрать.
export function extractNumericValue(s: string): string | null {
  const trimmed = s.trim()
  const fraction = trimmed.match(/^-?\d+(?:\s+\d+)?\/\d+/)
  if (fraction) return fraction[0].replace(',', '.')
  const m = trimmed.match(/^(-?\d+[.,]?\d*(?:[eE][+-]?\d+)?)/)
  return m ? m[1].replace(',', '.') : null
}

// Вариант между «|» — «простое» значение: число/слово(а), допускается ведущий
// минус. Так «|» в модуле («|x|», «1+|x|-2») и в таблицах разбалловки A-Level
// (пустые ячейки, LaTeX) не принимается за разделитель вариантов.
const PIPE_ALTERNATIVE_RE = /^[-–−]?[\p{L}\p{N}](?:[\p{L}\p{N}\s.,;]*[\p{L}\p{N}])?$/u

// Split correct answer alternatives ("–1012 или –1210" → ["–1012", "–1210"]).
// Эталоны библиотеки ФИПИ/sdamgia пишут варианты через «|»: «13|31» —
// «выберите два утверждения» в любом порядке, «145|154|415|…».
export function splitAlternatives(s: string): string[] {
  const parts = s.split(/\s+или\s+/i).map(x => x.trim()).filter(Boolean)
    .flatMap(part => {
      const pipeParts = part.split('|').map(x => x.trim())
      return pipeParts.length > 1 && pipeParts.every(p => PIPE_ALTERNATIVE_RE.test(p)) ? pipeParts : [part]
    })
  return parts.length > 0 ? parts : [s]
}
