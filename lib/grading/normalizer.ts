export function normalizeText(value: string, caseSensitive = false): string {
  let s = value.trim()
    .replace(/\s+/g, ' ')
    .replace(/,/g, '.')
    .replace(/[.;:!?\s]+$/, '') // strip trailing punctuation ("4,5." → "4.5")
  if (!caseSensitive) s = s.toLowerCase()
  return s
}

export function normalizeNumeric(value: string): number | null {
  const s = value.trim().replace(/[\s ]/g, '').replace(/,/g, '.')
  // Handle simple fractions: "5/2" → 2.5, "1/4" → 0.25
  const fracMatch = s.match(/^(-?\d+)\/(\d+)$/)
  if (fracMatch) {
    const num = parseFloat(fracMatch[1])
    const den = parseFloat(fracMatch[2])
    return den !== 0 ? num / den : null
  }
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

// Extract leading numeric value, discarding units ("19 км/ч" → "19", "4,5 м/с" → "4.5")
export function extractNumericValue(s: string): string | null {
  const m = s.trim().match(/^(-?\d+[.,]?\d*(?:[eE][+-]?\d+)?)/)
  return m ? m[1].replace(',', '.') : null
}

// Split correct answer alternatives ("–1012 или –1210" → ["–1012", "–1210"])
export function splitAlternatives(s: string): string[] {
  const parts = s.split(/\s+или\s+/i).map(x => x.trim()).filter(Boolean)
  return parts.length > 0 ? parts : [s]
}
