export function normalizeText(value: string, caseSensitive = false): string {
  let s = value.trim().replace(/\s+/g, ' ').replace(/,/g, '.')
  if (!caseSensitive) s = s.toLowerCase()
  return s
}

export function normalizeNumeric(value: string): number | null {
  const s = value.trim().replace(/[\s ]/g, '').replace(/,/g, '.')
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}
