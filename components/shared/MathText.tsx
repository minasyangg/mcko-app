'use client'

import { useEffect, useRef } from 'react'

interface Props {
  text: string
  className?: string
}

// Renders text with inline LaTeX: $...$ and $$...$$
// Falls back gracefully if katex is unavailable
export function MathText({ text, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current || !text) return
    import('katex').then((katex) => {
      if (!ref.current) return
      // Replace $$...$$ (display) then $...$ (inline)
      const html = text
        .replace(/\$\$([^$]+)\$\$/g, (_, math) => {
          try {
            return `<span class="katex-display-inline">${katex.default.renderToString(math.trim(), { displayMode: true, throwOnError: false })}</span>`
          } catch { return `<code>$$${math}$$</code>` }
        })
        .replace(/\$([^$\n]+)\$/g, (_, math) => {
          try {
            return katex.default.renderToString(math.trim(), { displayMode: false, throwOnError: false })
          } catch { return `<code>$${math}$</code>` }
        })
        // Preserve newlines as <br>
        .replace(/\n/g, '<br />')
      ref.current.innerHTML = html
    }).catch(() => {
      if (ref.current) ref.current.textContent = text
    })
  }, [text])

  return <div ref={ref} className={className}>{text}</div>
}
