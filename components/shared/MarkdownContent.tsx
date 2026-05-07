'use client'

import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import 'katex/dist/katex.min.css'

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': ['className', 'style'],
    img: ['src', 'alt', 'width', 'height', 'style'],
    table: ['className', 'style'],
    th: ['className', 'style', 'align', 'colspan', 'rowspan'],
    td: ['className', 'style', 'align', 'colspan', 'rowspan'],
  },
}

export default function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="
      prose prose-sm dark:prose-invert max-w-none
      [&_.katex]:text-base [&_.katex-display]:overflow-x-auto [&_.katex-display]:my-2
      [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_table]:my-2
      [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-1.5 [&_th]:bg-muted/50 [&_th]:font-medium [&_th]:text-left
      [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5
      [&_tr:nth-child(even)_td]:bg-muted/20
    ">
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[
          [rehypeKatex, { throwOnError: false, strict: false }],
          [rehypeSanitize, sanitizeSchema],
        ]}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
