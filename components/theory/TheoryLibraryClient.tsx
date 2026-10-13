'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { BookOpen, Eye, Pencil, Plus, Trash2, FilePlus2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import type { TheoryBlock, TheoryLibraryItem } from '@/lib/theory/types'
import { theoryExcerpt } from '@/lib/theory/types'
import { EMPTY_THEORY_FILTER, filterTheory, theoryFacets, type TheoryFilterState } from '@/lib/theory/filter'
import { TheoryFilters } from './TheoryFilters'
import { TheoryBlocksView } from './TheoryBlocksView'
import { TheoryForm, draftFromBlock, draftToPayload, type TheoryDraft } from './TheoryForm'
import { AddTheoryToTestDialog } from './AddTheoryToTestDialog'

// «Библиотека → Теория»: каталог блоков теории организации с фильтрами по
// предмету, классу и тегам. Отсюда блок подключается к любому тесту/ДЗ.
export function TheoryLibraryClient({ initialItems }: { initialItems: TheoryLibraryItem[] }) {
  const [items, setItems] = useState(initialItems)
  const [filter, setFilter] = useState<TheoryFilterState>(EMPTY_THEORY_FILTER)
  const [viewing, setViewing] = useState<TheoryLibraryItem | null>(null)
  // id редактируемого блока; 'new' — создание
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<TheoryDraft>(draftFromBlock())
  const [saving, setSaving] = useState(false)
  const [addTarget, setAddTarget] = useState<TheoryLibraryItem | null>(null)

  const facets = useMemo(() => theoryFacets(items), [items])
  const shown = useMemo(() => filterTheory(items, filter), [items, filter])

  function startEdit(item?: TheoryLibraryItem) {
    // новый блок наследует предмет/класс из текущего фильтра — обычно
    // учитель как раз наполняет каталог своего предмета и класса
    setDraft(item ? draftFromBlock(item) : draftFromBlock(null, { subject: filter.subject, grade: filter.grade }))
    setEditingId(item?.id ?? 'new')
  }

  async function save() {
    if (!editingId) return
    setSaving(true)
    try {
      const isNew = editingId === 'new'
      const res = await fetch(isNew ? '/api/theory' : `/api/theory/${editingId}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftToPayload(draft)),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? 'Не удалось сохранить теорию')
        return
      }
      const block = data.block as TheoryBlock
      setItems((prev) => isNew
        ? [{ ...block, usage_count: 0, can_edit: true }, ...prev]
        : prev.map((it) => (it.id === editingId ? { ...it, ...block } : it)))
      setEditingId(null)
      toast.success(isNew ? 'Теория добавлена в библиотеку' : 'Теория сохранена')
    } finally {
      setSaving(false)
    }
  }

  async function remove(item: TheoryLibraryItem) {
    const res = await fetch(`/api/theory/${item.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error ?? 'Не удалось удалить теорию')
      return
    }
    setItems((prev) => prev.filter((it) => it.id !== item.id))
    toast.success('Теория удалена')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <BookOpen className="h-6 w-6 text-sky-600" /> Теория
          </h1>
          <p className="text-sm text-muted-foreground">
            Выжимки теории к урокам. Подключаются к тестам и ДЗ — ученик видит их над заданиями.
            Всего блоков: {items.length}
          </p>
        </div>
        <Button onClick={() => startEdit()}>
          <Plus className="mr-1.5 h-4 w-4" /> Новая теория
        </Button>
      </div>

      <TheoryFilters value={filter} onChange={setFilter} {...facets} />

      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {items.length === 0 ? 'В библиотеке пока нет теории.' : 'По фильтрам ничего не найдено.'}
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {shown.map((it) => (
            <div key={it.id} className="flex flex-col rounded-lg border bg-card p-4">
              <button type="button" onClick={() => setViewing(it)} className="text-left">
                <h3 className="font-medium leading-snug hover:underline">{it.title}</h3>
              </button>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {it.subject && <Badge variant="secondary">{it.subject}</Badge>}
                {it.grade && <Badge variant="outline">{/^\d+$/.test(it.grade) ? `${it.grade} класс` : it.grade}</Badge>}
              </div>
              <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                {it.summary || theoryExcerpt(it.content_md)}
              </p>
              {it.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {it.tags.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setFilter((f) => (f.tags.includes(t) ? f : { ...f, tags: [...f.tags, t] }))}
                      className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] text-sky-800 hover:bg-sky-200 dark:bg-sky-950 dark:text-sky-200"
                      title="Показать теорию с этим тегом"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-auto flex items-center gap-1 pt-3">
                <span className="flex-1 text-xs text-muted-foreground">
                  {it.usage_count > 0 ? `В заданиях: ${it.usage_count}` : 'Ни к чему не подключена'}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setViewing(it)} title="Открыть">
                  <Eye className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAddTarget(it)}>
                  <FilePlus2 className="mr-1 h-4 w-4" /> В ДЗ
                </Button>
                {it.can_edit && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => startEdit(it)} title="Редактировать">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="text-destructive" title="Удалить">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Удалить теорию «{it.title}»?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {it.usage_count > 0
                              ? `Она подключена к заданиям (${it.usage_count}) — ученики перестанут её видеть. Задания не изменятся.`
                              : 'Теория ни к чему не подключена.'}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Отмена</AlertDialogCancel>
                          <AlertDialogAction onClick={() => remove(it)}>Удалить</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Просмотр — так, как увидит ученик */}
      <Sheet open={!!viewing} onOpenChange={(v) => { if (!v) setViewing(null) }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="border-b pb-3">
            <SheetTitle>{viewing?.title}</SheetTitle>
            <SheetDescription>
              {[viewing?.subject, viewing?.grade && `${viewing.grade} класс`, viewing?.tags.join(', ')].filter(Boolean).join(' · ')}
            </SheetDescription>
          </SheetHeader>
          {viewing && (
            <div className="space-y-4 px-4 pb-6">
              <TheoryBlocksView blocks={[viewing]} />
              <Button size="sm" variant="outline" onClick={() => setAddTarget(viewing)}>
                <FilePlus2 className="mr-1 h-4 w-4" /> Добавить в ДЗ
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Создание / правка */}
      <Sheet open={editingId !== null} onOpenChange={(v) => { if (!v && !saving) setEditingId(null) }}>
        <SheetContent side="right" className="w-full data-[side=right]:sm:max-w-5xl overflow-y-auto">
          <SheetHeader className="border-b pb-3">
            <SheetTitle>{editingId === 'new' ? 'Новая теория' : 'Редактировать теорию'}</SheetTitle>
            <SheetDescription>
              {editingId !== 'new' && (items.find((i) => i.id === editingId)?.usage_count ?? 0) > 0
                ? 'Блок подключён к заданиям — правка будет видна во всех сразу.'
                : 'После сохранения блок появится в библиотеке, его можно подключить к любому ДЗ.'}
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            <TheoryForm
              value={draft}
              onChange={setDraft}
              onSubmit={save}
              onCancel={() => setEditingId(null)}
              saving={saving}
              submitLabel={editingId === 'new' ? 'Добавить в библиотеку' : 'Сохранить'}
              subjectOptions={facets.subjects}
            />
          </div>
        </SheetContent>
      </Sheet>

      <AddTheoryToTestDialog
        open={!!addTarget}
        onClose={() => setAddTarget(null)}
        block={addTarget}
        onAdded={(already) => {
          const id = addTarget?.id
          if (id && !already) setItems((prev) => prev.map((it) => (it.id === id ? { ...it, usage_count: it.usage_count + 1 } : it)))
        }}
      />
    </div>
  )
}
