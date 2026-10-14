'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { TestTheoryBlock, TheoryBlock, TheoryListItem } from '@/lib/theory/types'
import { theoryExcerpt } from '@/lib/theory/types'
import { EMPTY_THEORY_FILTER, filterTheory, theoryFacets, type TheoryFilterState } from '@/lib/theory/filter'
import { TheoryFilters } from './TheoryFilters'

interface Props {
  open: boolean
  onClose: () => void
  testId: string
  linkedIds: string[]
  /** Предмет и класс ДЗ — фильтр по умолчанию, если такие есть в каталоге */
  defaultSubject: string | null
  defaultGrade: string | null
  onLinked: (block: TestTheoryBlock) => void
}

// Выбор теории из библиотеки со страницы ДЗ. Каталог берётся с сервера
// (GET /api/theory, облегчённый — без текста блоков): прямое чтение
// theory_blocks из браузера у учителя возвращало пустой список. Подключение —
// через API, оно же возвращает блок целиком для показа на странице ДЗ.
export function TheoryPickerDialog({ open, onClose, testId, linkedIds, defaultSubject, defaultGrade, onLinked }: Props) {
  const [items, setItems] = useState<TheoryListItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [filter, setFilter] = useState<TheoryFilterState>(EMPTY_THEORY_FILTER)
  const [linking, setLinking] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    // список с прошлого открытия виден, пока не придёт свежий
    fetch('/api/theory', { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`)
        return (data.items ?? []) as TheoryListItem[]
      })
      .then((list) => {
        if (cancelled) return
        setLoadError(null)
        setItems(list)
        const facets = theoryFacets(list)
        setFilter({
          ...EMPTY_THEORY_FILTER,
          subject: defaultSubject && facets.subjects.some((s) => s.subject === defaultSubject) ? defaultSubject : '',
          grade: defaultGrade && facets.grades.includes(defaultGrade) ? defaultGrade : '',
        })
      })
      .catch((e: Error) => { if (!cancelled) setLoadError(e.message || 'Не удалось загрузить библиотеку') })
    return () => { cancelled = true }
  }, [open, defaultSubject, defaultGrade, reloadKey])

  const facets = useMemo(() => theoryFacets(items ?? [], filter), [items, filter])
  const shown = useMemo(() => filterTheory(items ?? [], filter), [items, filter])

  async function link(block: TheoryListItem) {
    setLinking(block.id)
    try {
      const res = await fetch(`/api/theory/${block.id}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test_id: testId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? 'Не удалось подключить теорию')
        return
      }
      // в списке нет текста блока — полный блок приходит в ответе подключения
      const full = (data.block ?? { ...block, content_md: '' }) as TheoryBlock
      onLinked({ ...full, sort_order: data.sort_order ?? 0 })
      toast.success(`Теория «${block.title}» подключена`)
    } finally {
      setLinking(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-3xl" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Теория из библиотеки</DialogTitle>
          <DialogDescription>
            Подключённый блок не копируется: правка в библиотеке будет видна во всех заданиях, где он стоит.
          </DialogDescription>
        </DialogHeader>

        <TheoryFilters value={filter} onChange={setFilter} {...facets} />

        <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {loadError && (
            <div className="flex items-center gap-3 py-6 text-sm text-destructive">
              <span>Не удалось загрузить библиотеку: {loadError}</span>
              <Button size="sm" variant="outline" onClick={() => { setLoadError(null); setReloadKey((k) => k + 1) }}>
                Повторить
              </Button>
            </div>
          )}
          {items === null && !loadError && (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
            </p>
          )}
          {items !== null && shown.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {items.length === 0 ? 'В библиотеке пока нет теории.' : 'По фильтрам ничего не найдено.'}
            </p>
          )}
          {shown.map((b) => {
            const linked = linkedIds.includes(b.id)
            return (
              <div key={b.id} className="flex items-start gap-3 rounded-md border p-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-medium">{b.title}</p>
                  <div className="flex flex-wrap gap-1">
                    {b.subject && <Badge variant="secondary" className="text-[11px]">{b.subject}</Badge>}
                    {b.grade && <Badge variant="outline" className="text-[11px]">{b.grade} кл.</Badge>}
                    {b.tags.slice(0, 5).map((t) => (
                      <span key={t} className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] text-sky-800 dark:bg-sky-950 dark:text-sky-200">{t}</span>
                    ))}
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{b.summary || (b.content_md ? theoryExcerpt(b.content_md, 160) : '')}</p>
                </div>
                <Button
                  size="sm"
                  variant={linked ? 'ghost' : 'outline'}
                  disabled={linked || linking !== null}
                  onClick={() => link(b)}
                  className="shrink-0"
                >
                  {linked
                    ? <><Check className="mr-1 h-4 w-4" /> Подключена</>
                    : linking === b.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <><Plus className="mr-1 h-4 w-4" /> Подключить</>}
                </Button>
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
