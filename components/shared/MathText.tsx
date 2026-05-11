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
      // 1. Escape plain-text HTML first ($ and \ are not HTML-special, so LaTeX markers survive)
      const escaped = text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      // 2. Replace $$...$$ (display) then $...$ (inline) with trusted katex output
      const html = escaped
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
        // 3. Convert newlines to <br>
        .replace(/\n/g, '<br />')
      ref.current.innerHTML = html
    }).catch(() => {
      if (ref.current) ref.current.textContent = text
    })
  }, [text])

  return <div ref={ref} className={className}>{text}</div>
}
