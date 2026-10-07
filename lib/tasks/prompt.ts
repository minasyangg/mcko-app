// Исходник для MarkdownContent: размеченная версия (prompt_html,
// solution_html), а если её нет — простой текст. В простом тексте тоже бывают
// формулы $…$ (задания и решения, сохранённые без html-версии), поэтому он
// идёт через тот же рендер с KaTeX, а не выводится как есть — иначе ученик
// видел сырой LaTeX. Одиночные переносы строк делаем жёсткими (два пробела в
// конце строки): раньше такой текст шёл с whitespace-pre-wrap, а Markdown
// склеил бы строки в одну.
export function markdownSource(html: string | null | undefined, text: string | null | undefined): string {
  if (html) return html
  return (text ?? '').replace(/([^\n])\n(?!\n)/g, '$1  \n')
}

// Формулы $…$ как читаемый текст — для мест, где HTML/KaTeX невозможен
// (нативный <option>): частые команды → символы, остальная разметка убирается.
const PLAIN_SYMBOLS: Record<string, string> = {
  in: '∈', notin: '∉', cdot: '·', times: '×', div: '÷', pm: '±', leq: '≤', le: '≤', geq: '≥', ge: '≥',
  neq: '≠', ne: '≠', approx: '≈', infty: '∞', pi: 'π', alpha: 'α', beta: 'β', gamma: 'γ', Delta: 'Δ',
}
const BLACKBOARD: Record<string, string> = { N: 'ℕ', Z: 'ℤ', Q: 'ℚ', R: 'ℝ', C: 'ℂ' }
export function latexToPlain(s: string): string {
  return s.replace(/\$\$?([^$]+?)\$\$?/g, (_, m: string) => m.trim()
    .replace(/\\mathbb\{([A-Z])\}/g, (_, l: string) => BLACKBOARD[l] ?? l)
    .replace(/\\sqrt\[3\]\{([^{}]*)\}/g, '∛$1')
    .replace(/\\sqrt\{([^{}]*)\}/g, '√$1')
    .replace(/\\([a-zA-Z]+)/g, (_, c: string) => PLAIN_SYMBOLS[c] ?? '')
    .replace(/[{}]/g, ''))
}

// Извлекает читаемый plain-text из markdown/LaTeX-разметки задания — для
// поиска и фолбэк-рендера там, где MarkdownContent не используется. Формулы
// схлопываются в «[формула]», чтобы не мусорить обычным текстом тегами/LaTeX.
export function derivePromptText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\$\$[\s\S]+?\$\$/g, '[формула]')
    .replace(/\$[^$\n]+\$/g, '[формула]')
    .replace(/\s+/g, ' ')
    .trim() || html.slice(0, 200)
}
