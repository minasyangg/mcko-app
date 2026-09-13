'use client'

import { useCallback, useEffect, useState } from 'react'
import { X, ChevronLeft, ChevronRight, ZoomIn, ImageOff, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface GalleryImage {
  id: string
  signedUrl: string
  alt?: string | null
  sort_order: number
  /** Бейдж поверх миниатюры (например «стр. 3» у нераспознанных сканов) */
  badge?: React.ReactNode
  /** Контролы под миниатюрой (например привязка скана к заданию) */
  footer?: React.ReactNode
}

interface Props {
  images: GalleryImage[]
  onDelete?: (id: string) => void
  /** Идёт загрузка — гасит слот и показывает спиннер поверх него */
  uploading?: boolean
  uploadSlot?: React.ReactNode
  /**
   * Раскладка миниатюр:
   * - 'auto' (по умолчанию) — ряд с переносом, высота подстраивается под
   *   количество (как было исторически);
   * - 'grid' — сетка по правилу адаптивности проекта: на мобиле одна
   *   колонка (full-width), с планшета — две и больше.
   */
  layout?: 'auto' | 'grid'
  /**
   * z-index оверлея лайтбокса. По умолчанию 50. Внутри Radix-порталов
   * (Sheet/Dialog) нужен выше — иначе лайтбокс уедет ПОД панель.
   */
  lightboxZIndex?: number
}

export function ImageGallery({
  images, onDelete, uploading = false, uploadSlot,
  layout = 'auto', lightboxZIndex = 50,
}: Props) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  const sorted = [...images].sort((a, b) => a.sort_order - b.sort_order)
  const isMany = sorted.length > 2

  const total = sorted.length
  function openLightbox(idx: number) { setLightboxIdx(idx) }
  const closeLightbox = useCallback(() => setLightboxIdx(null), [])
  const prev = useCallback(
    () => setLightboxIdx(i => (i == null ? 0 : (i - 1 + total) % total)),
    [total]
  )
  const next = useCallback(
    () => setLightboxIdx(i => (i == null ? 0 : (i + 1) % total)),
    [total]
  )

  // Клавиатура в лайтбоксе: Escape закрывает, стрелки листают — ожидаемое
  // поведение полноэкранного просмотра, без него единственный выход мышью.
  // Заодно блокируем скролл страницы под оверлеем, иначе колесо прокручивает
  // список за ним, и после закрытия пользователь оказывается не там, где был.
  const isOpen = lightboxIdx !== null
  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeLightbox()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [isOpen, closeLightbox, prev, next])

  return (
    <>
      <div className={cn(
        layout === 'grid'
          // Правило адаптивности проекта: мобиль — full-width, планшет — 2 колонки
          ? 'grid grid-cols-1 sm:grid-cols-2 gap-3 items-start'
          : 'flex flex-wrap gap-2 items-start',
        layout === 'auto' && isMany && 'max-h-72 overflow-y-auto pr-1',
      )}>
        {sorted.map((img, idx) => (
          <div key={img.id} className={cn('relative group', layout === 'auto' && 'shrink-0')}>
            <button
              type="button"
              className="relative block cursor-zoom-in w-full text-left"
              onClick={() => openLightbox(idx)}
              title="Нажмите для увеличения"
              aria-label={`Открыть изображение ${idx + 1}`}
            >
              <GalleryThumb
                src={img.signedUrl}
                alt={img.alt ?? `Изображение ${idx + 1}`}
                className={cn(
                  'rounded border object-contain bg-white',
                  layout === 'grid'
                    ? 'w-full h-40'
                    : isMany ? 'h-24 w-auto max-w-35' : 'h-36 w-auto max-w-xs',
                )}
              />
              {/* Лупа: на тач-устройстве hover не наступает, и подсказки
                  «можно увеличить» не было вовсе — показываем постоянно,
                  а при мыши оставляем прежнее появление по наведению */}
              <div className="absolute inset-0 flex items-center justify-center transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
                <div className="bg-black/40 rounded-full p-1">
                  <ZoomIn className="h-4 w-4 text-white" />
                </div>
              </div>
              {img.badge}
            </button>
            {img.footer}
            {onDelete && (
              // На тач-устройстве hover не наступает никогда, и при
              // `hidden group-hover:flex` кнопка удаления была физически
              // недостижима с планшета/телефона. Показываем всегда там, где
              // нет точного указателя (hover:hover — только мышь), и держим
              // тач-таргет 44px по минимуму HIG/Material.
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(img.id) }}
                className="absolute -top-1.5 -right-1.5 flex items-center justify-center h-11 w-11 sm:h-5 sm:w-5 rounded-full bg-destructive text-destructive-foreground shadow z-10 [@media(hover:hover)]:hidden [@media(hover:hover)]:group-hover:flex"
                aria-label={`Удалить изображение ${idx + 1}`}
                title="Удалить"
              >
                <X className="h-4 w-4 sm:h-3 sm:w-3" />
              </button>
            )}
          </div>
        ))}
        {/* Слот загрузки: проп `uploading` раньше объявлялся, но не
            использовался — индикатор рисовал каждый вызывающий сам. Теперь
            слот гасится и накрывается спиннером централизованно. */}
        {uploadSlot && (
          <div className={cn('relative', layout === 'auto' && 'shrink-0')}>
            <div className={cn(uploading && 'opacity-40 pointer-events-none')}>
              {uploadSlot}
            </div>
            {uploading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && sorted[lightboxIdx] && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center"
          style={{ zIndex: lightboxZIndex }}
          onClick={closeLightbox}
        >
          {/* type="button" обязателен: галерея используется внутри <form>
              (InlineTaskForm), без него клик «закрыть»/«листать» отправлял бы
              форму вместо навигации по картинкам */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); closeLightbox() }}
            className="absolute top-4 right-4 text-white hover:text-white/70 transition-colors"
            aria-label="Закрыть"
          >
            <X className="h-7 w-7" />
          </button>

          {sorted.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); prev() }}
                className="absolute left-4 text-white hover:text-white/70 transition-colors p-2"
                aria-label="Предыдущее изображение"
              >
                <ChevronLeft className="h-8 w-8" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); next() }}
                className="absolute right-4 text-white hover:text-white/70 transition-colors p-2"
                aria-label="Следующее изображение"
              >
                <ChevronRight className="h-8 w-8" />
              </button>
            </>
          )}

          <div className="max-w-4xl max-h-[85vh] flex flex-col items-center gap-2" onClick={e => e.stopPropagation()}>
            <GalleryThumb
              src={sorted[lightboxIdx].signedUrl}
              alt={sorted[lightboxIdx].alt ?? `Изображение ${lightboxIdx + 1}`}
              className="max-h-[78vh] max-w-full object-contain rounded shadow-xl"
            />
            {sorted.length > 1 && (
              <span className="text-white/70 text-sm">{lightboxIdx + 1} / {sorted.length}</span>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// Экспортируется для экранов со своей раскладкой, куда ImageGallery целиком
// не подходит (например панель нераспознанных сканов в ReviewBoard: там своя
// сетка 2/3/4 колонки и контролы привязки под каждой картинкой), но правило
// про заглушку и lazy соблюдать всё равно обязательно.
//
// Миниатюра с заглушкой вместо сломанного тега. Правило проекта (AGENTS.md):
// «при пустом src или ошибке загрузки вместо картинки выводится заглушка
// „изображение недоступно“ (иконка ImageOff), а не сломанный тег». Раньше
// галерея рендерила сырой <img> и при протухшей ссылке показывала битую
// иконку браузера — из-за чего правило нарушалось везде, где она применена.
//
// Повторов, как в TaskImage, здесь нет сознательно: это учительские экраны
// (редактор, ревью, проверка работ), где ссылку легко обновить перезагрузкой,
// а не ученик посреди контрольной на школьном Wi-Fi.
export function GalleryThumb({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <span
        className={cn(
          className,
          'flex flex-col items-center justify-center gap-1 bg-muted text-muted-foreground',
          // у заглушки нет своей высоты, если className задаёт только h-auto
          !className?.includes('h-') && 'h-24',
        )}
        title="Изображение недоступно"
      >
        <ImageOff className="h-5 w-5" />
        <span className="text-[10px] leading-tight text-center px-1">Недоступно</span>
      </span>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => setFailed(true)}
    />
  )
}
