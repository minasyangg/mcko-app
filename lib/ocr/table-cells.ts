// PaddleOCR отдаёт многострочную ячейку таблицы с буквальным «\n» (обратный
// слэш + n) вместо переноса строки — на экране он виден как текст:
// «1\n1,00797\nВодород» (фрагмент таблицы Менделеева, ЕГЭ-физика 2026-10-27;
// так же пришли шапки таблиц в книгах). Внутри ячеек меняем его на <br>.
// Формулы $…$ не трогаем: там «\n» — начало команды LaTeX (\nu, \neq).
const CELL_RE = /(<t[dh][^>]*>)([\s\S]*?)(<\/t[dh]>)/gi
const MATH_RE = /(\$\$[\s\S]*?\$\$|\$[^$]*\$)/
// «\nu», «\neq» без $ — голый LaTeX (его рендерит MarkdownContent), не перенос
const LITERAL_BREAK_RE = /\\n(?!(?:u|e|eq|eg|abla|otin)(?![a-zA-Z]))/g
const EDGE_BREAKS_RE = /^(?:\s*<br>)+\s*|\s*(?:<br>\s*)+$/g

export function fixCellLineBreaks(html: string): string {
  if (!html.includes('\\n') || !/<t[dh][\s>]/i.test(html)) return html
  return html.replace(CELL_RE, (_, open: string, body: string, close: string) => {
    const fixed = body
      .split(MATH_RE)
      .map((part, i) => (i % 2 === 1 ? part : part.replace(LITERAL_BREAK_RE, '<br>')))
      .join('')
      .replace(EDGE_BREAKS_RE, '')
    return open + fixed + close
  })
}
