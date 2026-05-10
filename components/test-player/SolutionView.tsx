import { TaskImageGallery } from './TaskImageGallery'
import MarkdownContent from '@/components/shared/MarkdownContent'
import type { TaskMediaWithUrl } from '@/types/domain'

interface Props {
  solutionText: string | null
  solutionHtml: string | null
  media: TaskMediaWithUrl[]
}

export function SolutionView({ solutionText, solutionHtml, media }: Props) {
  if (!solutionText && !solutionHtml && media.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">Текст решения не добавлен.</p>
    )
  }

  return (
    <div className="space-y-3">
      {media.length > 0 && (
        <TaskImageGallery images={media} placement="above_text" />
      )}
      {solutionHtml ? (
        <MarkdownContent content={solutionHtml} />
      ) : solutionText ? (
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{solutionText}</p>
      ) : null}
      {media.length > 0 && (
        <TaskImageGallery images={media} placement="below_text" />
      )}
    </div>
  )
}
