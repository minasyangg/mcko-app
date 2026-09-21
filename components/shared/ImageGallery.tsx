'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw, ImageOff, Loader2 } from 'lucide-react'
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

const ZOOM_MIN = 1
const ZOOM_MAX = 4
const ZOOM_STEP = 0.5

export function ImageGallery({
  images, onDelete, uploading = false, uploadSlot,
  layout = 'auto', lightboxZIndex = 50,
}: Props) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  const sorted = [...images].sort((a, b) => a.sort_order - b.sort_order)
  const isMany = sorted.length > 2

  // Zoom/pan увеличенной картинки в лайтбоксе — колесо мыши, pinch на тач,
  // кнопки +/− для мыши без колеса. scale=1 — обычный object-contain режим
  // (перетаскивание/pan отключены, чтобы не мешать обычному клику "закрыть
  // по фону"). offset — сдвиг в px при scale>1, чтобы можно было
  // рассмотреть край увеличенного изображения (мелкий текст в таблице,
  // деталь графика), не только центр.
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; startOffX: number; startOffY: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(null)

  const resetZoom = useCallback(() => { setScale(1); setOffset({ x: 0, y: 0 }) }, [])
  const clampScale = (s: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s))

  const total = sorted.length
  function openLightbox(idx: number) { setLightboxIdx(idx); resetZoom() }
  const closeLightbox = useCallback(() => { setLightboxIdx(null); resetZoom() }, [resetZoom])
  const prev = useCallback(
    () => { setLightboxIdx(i => (i == null ? 0 : (i - 1 + total) % total)); resetZoom() },
    [total, resetZoom]
  )
  const next = useCallback(
    () => { setLightboxIdx(i => (i == null ? 0 : (i + 1) % total)); resetZoom() },
    [total, resetZoom]
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
      // Стрелки листают только пока не увеличено — иначе они конфликтовали
      // бы с ожиданием "подвигать увеличенную картинку" (drag уже это даёт,
      // стрелки на клавиатуре для pan не заведены, чтобы не путать с листанием).
      else if (e.key === 'ArrowLeft' && scale === 1) prev()
      else if (e.key === 'ArrowRight' && scale === 1) next()
      else if (e.key === '+' || e.key === '=') setScale(s => clampScale(s + ZOOM_STEP))
      else if (e.key === '-') setScale(s => clampScale(s - ZOOM_STEP))
      else if (e.key === '0') resetZoom()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [isOpen, closeLightbox, prev, next, scale, resetZoom])

  // Колесо мыши = zoom (вместо скролла страницы, тот уже заблокирован выше).
  // Знак минус — стандартное направление (от себя/вверх = приближение).
  function onWheelZoom(e: React.WheelEvent) {
    e.preventDefault()
    setScale(s => clampScale(s - e.deltaY * 0.0015 * ZOOM_MAX))
  }

  // Перетаскивание увеличенного изображения мышью — активно только при
  // scale>1, иначе конфликтовало бы с закрытием по клику на фон.
  function onImagePointerDown(e: React.PointerEvent) {
    if (scale <= 1) return
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOffX: offset.x, startOffY: offset.y }
    setDragging(true)
  }
  function onImagePointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    setOffset({ x: dragRef.current.startOffX + dx, y: dragRef.current.startOffY + dy })
  }
  function onImagePointerUp() {
    dragRef.current = null
    setDragging(false)
  }

  // Pinch-to-zoom на тач — два touch-пойнтера, масштаб по изменению
  // расстояния между ними относительно расстояния на touchstart.
  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length !== 2) return
    const [a, b] = [e.touches[0], e.touches[1]]
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    pinchRef.current = { startDist: dist, startScale: scale }
  }
  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length !== 2 || !pinchRef.current) return
    e.preventDefault()
    const [a, b] = [e.touches[0], e.touches[1]]
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    const ratio = dist / pinchRef.current.startDist
    setScale(clampScale(pinchRef.current.startScale * ratio))
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (e.touches.length < 2) pinchRef.current = null
  }

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
          // bg-black (непрозрачный), не bg-black/80 — лайтбокс может
          // открываться поверх ДРУГОГО полупрозрачного оверлея (например
          // TaskFullscreenView, bg-black/60), и раньше 80%-прозрачность
          // одного давала просвечивание фона/текста нижнего оверлея сквозь
          // оба слоя сразу — итоговая картинка и текст под ней выглядели
          // затемнённой нечитаемой "пеленой" вместо чистого просмотра.
          className="fixed inset-0 bg-black flex items-center justify-center overflow-hidden select-none"
          style={{ zIndex: lightboxZIndex }}
          onClick={closeLightbox}
          onWheel={onWheelZoom}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* type="button" обязателен: галерея используется внутри <form>
              (InlineTaskForm), без него клик «закрыть»/«листать» отправлял бы
              форму вместо навигации по картинкам */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); closeLightbox() }}
            className="absolute top-4 right-4 text-white hover:text-white/70 transition-colors z-10"
            aria-label="Закрыть"
          >
            <X className="h-7 w-7" />
          </button>

          {/* Zoom-контролы — колесо/pinch уже работают, но мышь без колеса
              и десктоп без тачскрина иначе не имели бы способа увеличить. */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/50 rounded-full px-2 py-1 z-10" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setScale(s => clampScale(s - ZOOM_STEP))}
              disabled={scale <= ZOOM_MIN}
              className="text-white hover:text-white/70 disabled:opacity-30 p-1.5"
              aria-label="Уменьшить"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="text-white/80 text-xs tabular-nums w-10 text-center">{Math.round(scale * 100)}%</span>
            <button
              type="button"
              onClick={() => setScale(s => clampScale(s + ZOOM_STEP))}
              disabled={scale >= ZOOM_MAX}
              className="text-white hover:text-white/70 disabled:opacity-30 p-1.5"
              aria-label="Увеличить"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            {scale !== 1 && (
              <button type="button" onClick={resetZoom} className="text-white hover:text-white/70 p-1.5" aria-label="Сбросить масштаб" title="Сбросить масштаб">
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {sorted.length > 1 && scale === 1 && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); prev() }}
                className="absolute left-4 text-white hover:text-white/70 transition-colors p-2 z-10"
                aria-label="Предыдущее изображение"
              >
                <ChevronLeft className="h-8 w-8" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); next() }}
                className="absolute right-4 text-white hover:text-white/70 transition-colors p-2 z-10"
                aria-label="Следующее изображение"
              >
                <ChevronRight className="h-8 w-8" />
              </button>
            </>
          )}

          <div
            className="max-w-4xl max-h-[85vh] w-full h-full flex flex-col items-center justify-center gap-2"
            onClick={e => {
              e.stopPropagation()
              // Клик по картинке (не drag) при обычном масштабе — быстрый
              // зум на 1 шаг, тот же жест, что интуитивно ждут от "клик на
              // фото = приблизить". При scale>1 клик ничего не делает —
              // только drag двигает, разжимать нужно явно кнопкой/колесом.
              if (scale === 1) setScale(clampScale(ZOOM_MIN + ZOOM_STEP))
            }}
          >
            <GalleryThumb
              src={sorted[lightboxIdx].signedUrl}
              alt={sorted[lightboxIdx].alt ?? `Изображение ${lightboxIdx + 1}`}
              className={cn(
                // bg-white обязателен: у заданий (графики/схемы) картинки
                // часто PNG с прозрачным фоном — без непрозрачной подложки
                // затемнённый фон лайтбокса (bg-black/80 ниже) просвечивал
                // сквозь прозрачные области насквозь, и чёрные линии графика
                // сливались с ним в трудноразличимое серое пятно (миниатюра
                // в сетке уже была с bg-white, а увеличенная версия в
                // лайтбоксе — нет, отсюда и разница в читаемости).
                'max-h-[78vh] max-w-full object-contain rounded shadow-xl transition-transform bg-white',
                scale > 1 ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in',
              )}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                transitionDuration: dragging ? '0ms' : '100ms',
              }}
              onPointerDownCapture={onImagePointerDown}
              onPointerMove={onImagePointerMove}
              onPointerUp={onImagePointerUp}
            />
            {sorted.length > 1 && scale === 1 && (
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
export function GalleryThumb({
  src, alt, className, style, onPointerDownCapture, onPointerMove, onPointerUp,
}: {
  src: string
  alt: string
  className?: string
  /** Используется лайтбоксом для zoom/pan (transform: scale+translate) — обычные миниатюры это не передают. */
  style?: React.CSSProperties
  onPointerDownCapture?: React.PointerEventHandler<HTMLImageElement>
  onPointerMove?: React.PointerEventHandler<HTMLImageElement>
  onPointerUp?: React.PointerEventHandler<HTMLImageElement>
}) {
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
      style={style}
      onError={() => setFailed(true)}
      onPointerDownCapture={onPointerDownCapture}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}
