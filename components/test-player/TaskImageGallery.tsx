import type { TaskMediaWithUrl } from '@/types/domain'
import { TaskImage } from './TaskImage'

interface TaskImageGalleryProps {
  images: TaskMediaWithUrl[]
  placement: 'above_text' | 'below_text' | 'inline'
}

export function TaskImageGallery({ images, placement }: TaskImageGalleryProps) {
  // inline images are embedded in prompt_html — skip here
  const filtered = images
    .filter((img) => (img.placement ?? 'above_text') === placement)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  if (filtered.length === 0) return null

  if (filtered.length === 1) {
    const img = filtered[0]
    return (
      <div className="w-full">
        <TaskImage
          src={img.signedUrl}
          alt={img.alt_text}
          width={img.width_px}
          height={img.height_px}
          priority={placement === 'above_text'}
        />
      </div>
    )
  }

  // Multiple images — responsive grid; first image gets priority load
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {filtered.map((img, idx) => (
        <TaskImage
          key={img.id}
          src={img.signedUrl}
          alt={img.alt_text}
          width={img.width_px}
          height={img.height_px}
          priority={placement === 'above_text' && idx === 0}
        />
      ))}
    </div>
  )
}
