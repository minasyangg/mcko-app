'use client'

import katex from 'katex'
import 'katex/dist/katex.min.css'

interface Props {
  text: string
  className?: string
}

// Synchronously render inline LaTeX ($...$ and $$...$$) to KaTeX HTML.
// Uses dangerouslySetInnerHTML so React does not own the text children —
// avoids React 19 hydration error #418 that occurs when innerHTML is
// modified externally while React expects a managed text node.
function renderMathText(raw: string): string {
  if (!raw) return ''
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped
    .replace(/\$\$([^$]+)\$\$/g, (_, math) => {
      try {
        return `<span>${katex.renderToString(math.trim(), { displayMode: true, throwOnError: false })}</span>`
      } catch { return `<code>$$${math}$$</code>` }
    })
    .replace(/\$([^$\n]+)\$/g, (_, math) => {
      try {
        return katex.renderToString(math.trim(), { displayMode: false, throwOnError: false })
      } catch { return `<code>$${math}$</code>` }
    })
    .replace(/\n/g, '<br />')
}

export function MathText({ text, className }: Props) {
  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: renderMathText(text) }}
    />
  )
}
