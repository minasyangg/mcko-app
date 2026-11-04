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
// Экранирование ниже нужно для текста вокруг формул; внутрь KaTeX формула
// должна попасть исходной — иначе «$x > 5$» превращалось в «x &gt; 5» и
// KaTeX падал с ошибкой парсинга. Вывод KaTeX сам по себе безопасный HTML.
// Два прохода: экранирование ниже + сущности, уже бывшие в исходнике
// (OCR-текст из HTML, разбалловка A-Level: «r^{N-1} &gt; 1.6»).
function unescapeMath(math: string): string {
  let s = math.trim()
  for (let i = 0; i < 2; i++) s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  return s
}

// Переводы строк → <br /> только в тексте вокруг формул: в выводе KaTeX они
// есть внутри SVG-пути радикала (\sqrt), и <br /> в атрибуте d стирал знак корня.
function renderMathText(raw: string): string {
  if (!raw) return ''
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped
    .split(/(\$\$[^$]+\$\$|\$[^$\n]+\$)/g)
    .map((part, i) => {
      if (i % 2 === 0) return part.replace(/\n/g, '<br />')
      const display = part.startsWith('$$')
      const math = display ? part.slice(2, -2) : part.slice(1, -1)
      try {
        const html = katex.renderToString(unescapeMath(math), { displayMode: display, throwOnError: false })
        return display ? `<span>${html}</span>` : html
      } catch { return `<code>${part}</code>` }
    })
    .join('')
}

export function MathText({ text, className }: Props) {
  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: renderMathText(text) }}
    />
  )
}
