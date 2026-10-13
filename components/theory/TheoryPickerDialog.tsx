'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { TestTheoryBlock, TheoryBlock } from '@/lib/theory/types'
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

// Выбор теории из библиотеки со страницы ДЗ. Каталог читается напрямую по RLS
// (персонал видит теорию своей организации), подключение — через API.
export function TheoryPickerDialog({ open, onClose, testId, linkedIds, defaultSubject, defaultGrade, onLinked }: Props) {
  const [items, setItems] = useState<TheoryBlock[] | null>(null)
  const [filter, setFilter] = useState<TheoryFilterState>(EMPTY_THEORY_FILTER)
  const [linking, setLinking] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    // список с прошлого открытия виден, пока не придёт свежий
    createClient()
      .from('theory_blocks')
      .select('id, title, content_md, source_ref, subject, grade, tags, summary, created_by, updated_at')
      .order('updated_at', { ascending: false })
      .limit(300)
      .then(({ data }) => {
        const list = (data ?? []).map((b) => ({ ...b, tags: b.tags ?? [] })) as TheoryBlock[]
        setItems(list)
        const facets = theoryFacets(list)
        setFilter({
          ...EMPTY_THEORY_FILTER,
          subject: defaultSubject && facets.subjects.includes(defaultSubject) ? defaultSubject : '',
          grade: defaultGrade && facets.grades.includes(defaultGrade) ? defaultGrade : '',
        })
      })
  }, [open, defaultSubject, defaultGrade])

  const facets = useMemo(() => theoryFacets(items ?? []), [items])
  const shown = useMemo(() => filterTheory(items ?? [], filter), [items, filter])

  async function link(block: TheoryBlock) {
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
      onLinked({ ...block, sort_order: data.sort_order ?? 0 })
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

        <TheoryFilters value={filter} onChange={setFilter} {...facets} tagLimit={20} />

        <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {items === null && (
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
                  <p className="line-clamp-2 text-xs text-muted-foreground">{b.summary || theoryExcerpt(b.content_md, 160)}</p>
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
