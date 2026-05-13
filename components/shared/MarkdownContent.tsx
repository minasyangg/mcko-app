'use client'

import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import katex from 'katex'
import 'katex/dist/katex.min.css'

// rehype-sanitize schema: allow HTML tables (PaddleOCR) + KaTeX output
// KaTeX uses <svg>/<path> for stretchy symbols like √ even with output:'html'
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'div', 'span',
    // KaTeX SVG elements (needed for √ radical, integral signs, brackets, etc.)
    'svg', 'path', 'g', 'line', 'rect', 'circle', 'polygon', 'polyline',
    'defs', 'use', 'symbol', 'mask', 'clipPath',
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': ['className', 'style', 'aria-hidden', 'aria-label', 'role'],
    img: ['src', 'alt', 'width', 'height', 'style'],
    table: ['className', 'style', 'border', 'cellpadding', 'cellspacing'],
    th: ['className', 'style', 'align', 'colspan', 'rowspan'],
    td: ['className', 'style', 'align', 'colspan', 'rowspan'],
    div: ['className', 'style'],
    span: ['className', 'style'],
    // Safe SVG geometry attributes (no event handlers, no scripts)
    svg: ['xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'style', 'aria-hidden'],
    path: ['d', 'fill', 'stroke', 'stroke-width', 'fill-rule', 'clip-rule'],
    g: ['transform', 'fill', 'stroke'],
    line: ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width'],
    rect: ['x', 'y', 'width', 'height', 'fill', 'stroke', 'rx', 'ry'],
    circle: ['cx', 'cy', 'r', 'fill', 'stroke'],
    use: ['href', 'x', 'y', 'width', 'height'],
    symbol: ['id', 'viewBox'],
  },
}

// Fix OCR errors: /command → \command (PaddleOCR sometimes outputs / instead of \)
const LATEX_CMDS = ['sqrt','frac','cfrac','dfrac','tfrac','cdot','times','div','pm','mp',
  'leq','geq','neq','approx','sim','equiv','propto','alpha','beta','gamma','delta','epsilon',
  'varepsilon','zeta','eta','theta','vartheta','iota','kappa','lambda','mu','nu','xi','pi',
  'varpi','rho','varrho','sigma','varsigma','tau','upsilon','phi','varphi','chi','psi','omega',
  'Gamma','Delta','Theta','Lambda','Xi','Pi','Sigma','Upsilon','Phi','Psi','Omega',
  'sin','cos','tan','cot','sec','csc','arcsin','arccos','arctan','sinh','cosh','tanh',
  'ln','log','exp','lim','max','min','sup','inf','det','sum','prod','int','oint',
  'infty','partial','nabla','vec','hat','bar','tilde','dot','ddot','widehat','widetilde',
  'overline','underline','overbrace','underbrace','left','right','middle',
  'text','mathrm','mathbf','mathit','mathbb','mathcal','mathsf','mathtt',
  'begin','end','quad','qquad','hline','over','binom','choose',
  'to','gets','Rightarrow','Leftarrow','rightarrow','leftarrow','leftrightarrow',
  'Leftrightarrow','uparrow','downarrow','ne','le','ge','ll','gg','in','notin',
  'subset','supset','cup','cap','emptyset','forall','exists','neg','land','lor']

function fixOCRSlashes(math: string): string {
  let s = math.trim()
  for (const cmd of LATEX_CMDS) {
    s = s.replace(new RegExp(`/${cmd}(?=[^a-zA-Z]|$)`, 'g'), `\\${cmd}`)
  }
  return s
}

const CYRILLIC_LABELS = ['А', 'Б', 'В', 'Г', 'Д', 'Е']

// Fix answer-box tables: replace first-row cells with Cyrillic А/Б/В/Г by position.
// Only applies to 2-row tables where the second row is empty (student answer boxes).
function fixAnswerTableHeaders(tableHtml: string): string {
  const rows = [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)]
  if (rows.length !== 2) return tableHtml
  const secondRowCells = [...rows[1][0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
  if (!secondRowCells.every(m => m[1].trim() === '')) return tableHtml
  let ci = 0
  const fixedFirstRow = rows[0][0].replace(/<td([^>]*)>[\s\S]*?<\/td>/gi, (_, attrs) => {
    return `<td${attrs}>${CYRILLIC_LABELS[ci++] ?? '?'}</td>`
  })
  return tableHtml.replace(rows[0][0], fixedFirstRow)
}

// Detect OGЭ/МЦКО matching tasks (Cyrillic А/Б/В items vs numbered 1/2/3 items)
// and reformat into a two-column table. Falls through unchanged for other content.
function reformatMatchingTask(content: string): string {
  const LETTER_RE = /^([А-Е])\)\s*(.+)$/
  const NUMBER_RE = /^(\d+)\)\s*(.+)$/
  // Split by HTML tables so we process text and tables separately
  const parts = content.split(/(<table[\s\S]*?<\/table>)/i)
  const letterItems: { label: string; text: string }[] = []
  const numberItems: { num: string; text: string }[] = []
  for (let i = 0; i < parts.length; i += 2) {
    for (const line of parts[i].split('\n').map(l => l.trim()).filter(Boolean)) {
      const lm = line.match(LETTER_RE)
      const nm = line.match(NUMBER_RE)
      if (lm) letterItems.push({ label: lm[1], text: lm[2] })
      else if (nm) numberItems.push({ num: nm[1], text: nm[2] })
    }
  }
  if (letterItems.length < 2 || numberItems.length < 2) {
    return parts.map((p, i) => i % 2 === 1 ? fixAnswerTableHeaders(p) : p).join('')
  }
  // Collect intro lines (everything before the first letter/number item)
  const introLines: string[] = []
  let found = false
  for (let i = 0; i < parts.length && !found; i += 2) {
    for (const line of parts[i].split('\n').map(l => l.trim()).filter(Boolean)) {
      if (line.match(LETTER_RE) || line.match(NUMBER_RE)) { found = true; break }
      introLines.push(line)
    }
  }
  // Build two-column matching table
  const maxRows = Math.max(letterItems.length, numberItems.length)
  let matchTable = '<table style="margin:8px 0"><tbody>'
  for (let r = 0; r < maxRows; r++) {
    const left = letterItems[r] ? `${letterItems[r].label}) ${letterItems[r].text}` : ''
    const right = numberItems[r] ? `${numberItems[r].num}) ${numberItems[r].text}` : ''
    matchTable += `<tr><td style="vertical-align:top">${left}</td><td style="vertical-align:top">${right}</td></tr>`
  }
  matchTable += '</tbody></table>'
  const htmlTables = parts.filter((_, i) => i % 2 === 1).map(fixAnswerTableHeaders)
  const intro = introLines.join('\n\n')
  return [intro, matchTable, ...htmlTables].filter(Boolean).join('\n\n')
}

// Pre-render LaTeX to KaTeX HTML BEFORE ReactMarkdown sees it.
// remark-math v6 applies CommonMark backslash escaping inside $...$
// (\sqrt → sqrt, \frac → form-feed+rac, etc.), making formulas unrenderable.
// By calling katex.renderToString() here, we bypass that issue entirely.
function prerenderMath(content: string): string {
  const render = (math: string, display: boolean): string => {
    const latex = fixOCRSlashes(math)
    try {
      return katex.renderToString(latex, {
        displayMode: display,
        throwOnError: false,
        strict: false,
        output: 'html',  // HTML+SVG (no MathML); SVG is allowed in sanitizeSchema
      })
    } catch {
      return display ? `$$${math}$$` : `$${math}$`
    }
  }
  // Display math first to avoid mis-matching single-$ inside $$...$$
  return content
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => render(m, true))
    .replace(/\$([^$\n]+?)\$/g, (_, m) => render(m, false))
}

export default function MarkdownContent({ content }: { content: string }) {
  const processed = prerenderMath(reformatMatchingTask(content))
  return (
    <div className="
      prose prose-sm dark:prose-invert max-w-none overflow-x-auto
      [&_.katex]:text-base [&_.katex-display]:overflow-x-auto [&_.katex-display]:my-2
      [&_table]:border-collapse [&_table]:text-sm [&_table]:my-2
      [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-1.5 [&_th]:bg-muted/50 [&_th]:font-medium [&_th]:text-center
      [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5 [&_td]:min-w-10
      [&_tr:nth-child(even)_td]:bg-muted/20
    ">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, sanitizeSchema],
        ]}
        remarkRehypeOptions={{ allowDangerousHtml: true }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  )
}
