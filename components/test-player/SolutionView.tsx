import { TaskImageGallery } from './TaskImageGallery'
import MarkdownContent from '@/components/shared/MarkdownContent'
import { markdownSource } from '@/lib/tasks/prompt'
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
      {(solutionHtml || solutionText) && (
        <MarkdownContent content={markdownSource(solutionHtml, solutionText)} />
      )}
      {media.length > 0 && (
        <TaskImageGallery images={media} placement="below_text" />
      )}
    </div>
  )
}
