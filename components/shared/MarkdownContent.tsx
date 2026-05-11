'use client'

import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import 'katex/dist/katex.min.css'

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

// Fix common OCR error: /command → \command within LaTeX math delimiters
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
  'begin','end','quad','qquad','hline','over','sqrt','binom','choose',
  'to','gets','Rightarrow','Leftarrow','rightarrow','leftarrow','leftrightarrow',
  'Leftrightarrow','uparrow','downarrow','ne','le','ge','ll','gg','in','notin',
  'subset','supset','cup','cap','emptyset','forall','exists','neg','land','lor']

function fixLatexOCRErrors(content: string): string {
  const fix = (math: string) => {
    let s = math
    for (const cmd of LATEX_CMDS) {
      s = s.replace(new RegExp(`/${cmd}(?=[^a-zA-Z]|$)`, 'g'), `\\${cmd}`)
    }
    return s
  }
  // Apply only inside $$ ... $$ and $ ... $
  return content
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => `$$${fix(m)}$$`)
    .replace(/\$([^$\n]+?)\$/g, (_, m) => `$${fix(m)}$`)
}

export default function MarkdownContent({ content }: { content: string }) {
  const normalized = fixLatexOCRErrors(content)
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
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeKatex, { throwOnError: false, strict: false }],
          [rehypeSanitize, sanitizeSchema],
        ]}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  )
}
