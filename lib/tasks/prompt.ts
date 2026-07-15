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
