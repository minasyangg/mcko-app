import type { Json } from '@/types/database'

// Составные ответы (multi-part-answer.ts) хранят части эталона как голый
// LaTeX без обрамления $…$ (например `[3; +\infty)`, `\left(-∞;-2\right]`) —
// buildCompositeAnswerKey чистит только \frac, остальные команды остаются
// как есть. formatAnswerJson показывает их через MathText, а тот парсит
// только то, что внутри $…$ — без обёртки KaTeX не подхватывает и зритель
// видит сырые "\infty"/"\left". Если строка уже содержит $ (эталон, который
// учитель сам набрал с долларами через редактирование), считаем её
// оформленной и не трогаем — двойное оборачивание сломало бы разметку.
const HAS_LATEX_COMMAND = /\\[a-zA-Z]+/
function wrapBareLatex(s: string): string {
  if (!s || s.includes('$') || !HAS_LATEX_COMMAND.test(s)) return s
  return `$${s}$`
}

// Человекочитаемое представление answer_json/correct_answer для отображения
// учителю и передачи в ИИ-проверку (была продублирована как answerToString в
// AttemptDrawer.tsx и formatAnswer в result/page.tsx — вынесена в общее место).
// Поддерживает обе формы `parts`: студенческую {label: string} (Composite.tsx)
// и эталонную {label: {value, method}} (составной ответ, см. multi-part-answer.ts).
export function formatAnswerJson(json: Json | null | undefined): string {
  if (json === null || json === undefined) return '—'
  if (typeof json === 'string') return wrapBareLatex(json)
  if (typeof json === 'number') return String(json)
  if (typeof json === 'boolean') return json ? 'Да' : 'Нет'
  if (Array.isArray(json)) return json.map(v => formatAnswerJson(v)).join(', ')

  const obj = json as Record<string, Json | undefined>

  if ('selected' in obj) {
    const sel = obj['selected']
    return Array.isArray(sel) ? sel.map(v => formatAnswerJson(v as Json)).join(', ') : formatAnswerJson(sel ?? null)
  }
  if ('text' in obj) return formatAnswerJson(obj['text'] ?? null)
  if ('value' in obj) return formatAnswerJson(obj['value'] ?? null)
  if ('parts' in obj && obj['parts'] !== null && typeof obj['parts'] === 'object' && !Array.isArray(obj['parts'])) {
    const parts = obj['parts'] as Record<string, Json | undefined>
    return Object.entries(parts)
      .map(([label, entry]) => {
        // эталонная форма {value, method} — берём только значение
        const v = entry !== null && typeof entry === 'object' && !Array.isArray(entry) && 'value' in entry
          ? (entry as Record<string, Json | undefined>)['value']
          : entry
        return `${label}: ${formatAnswerJson(v ?? null)}`
      })
      .join('; ')
  }

  return JSON.stringify(json)
}
