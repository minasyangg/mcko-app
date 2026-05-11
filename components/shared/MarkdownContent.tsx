'use client'

import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import katex from 'katex'
import 'katex/dist/katex.min.css'

// rehype-sanitize schema: allow HTML tables (PaddleOCR) + KaTeX span output
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'div', 'span',
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': ['className', 'style'],
    img: ['src', 'alt', 'width', 'height', 'style'],
    table: ['className', 'style', 'border', 'cellpadding', 'cellspacing'],
    th: ['className', 'style', 'align', 'colspan', 'rowspan'],
    td: ['className', 'style', 'align', 'colspan', 'rowspan'],
    div: ['className', 'style'],
    span: ['className', 'style'],
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
        output: 'html',  // spans only — no <math> MathML, passes rehypeSanitize
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
  const processed = prerenderMath(content)
  return (
    <div className="
      prose prose-sm dark:prose-invert max-w-none
      [&_.katex]:text-base [&_.katex-display]:overflow-x-auto [&_.katex-display]:my-2
      [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_table]:my-2
      [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-1.5 [&_th]:bg-muted/50 [&_th]:font-medium [&_th]:text-left
      [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5
      [&_tr:nth-child(even)_td]:bg-muted/20
      [&_table]:overflow-x-auto [&_table]:block
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
