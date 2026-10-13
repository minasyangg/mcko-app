'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, BookOpen, ChevronDown, ChevronUp, Library, Pencil, Plus, Unlink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import type { TestTheoryBlock, TheoryBlock } from '@/lib/theory/types'
import { TheoryBlocksView } from './TheoryBlocksView'
import { TheoryForm, draftFromBlock, draftToPayload, type TheoryDraft } from './TheoryForm'
import { TheoryPickerDialog } from './TheoryPickerDialog'

export type PanelTheoryBlock = TestTheoryBlock & { can_edit: boolean }

interface Props {
  testId: string
  initialBlocks: PanelTheoryBlock[]
  /** Создатель ДЗ или админ — может подключать/отключать теорию */
  canEditTest: boolean
  /** Предмет и класс ДЗ: подставляются в новый блок и в фильтр выбора из библиотеки */
  testSubject: string | null
  testGrade: string | null
  /** Кто смотрит: автор блока или админ может его править */
  viewerId: string | null
  viewerIsAdmin: boolean
}

// Блок «Теория» на странице ДЗ. Сама теория живёт в библиотеке
// («Библиотека → Теория»); здесь она подключается к ДЗ (выбором из каталога
// или созданием нового блока) и отключается. Править блок может его автор
// или админ — правка видна во всех ДЗ, где блок подключён.
export function TheoryEditorPanel({ testId, initialBlocks, canEditTest, testSubject, testGrade, viewerId, viewerIsAdmin }: Props) {
  const [blocks, setBlocks] = useState<PanelTheoryBlock[]>(initialBlocks)
  // 'new' — создание; id — правка блока
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<TheoryDraft>(draftFromBlock())
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [pickerOpen, setPickerOpen] = useState(false)

  function startEdit(block?: PanelTheoryBlock) {
    setDraft(block ? draftFromBlock(block) : draftFromBlock(null, { subject: testSubject, grade: testGrade }))
    setEditingId(block?.id ?? 'new')
  }

  async function save() {
    if (!editingId) return
    setSaving(true)
    try {
      const isNew = editingId === 'new'
      const res = await fetch(isNew ? `/api/tests/${testId}/theory` : `/api/theory/${editingId}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftToPayload(draft)),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? 'Не удалось сохранить теорию')
        return
      }
      const block = data.block as TheoryBlock & { sort_order?: number }
      setBlocks((prev) => isNew
        ? [...prev, { ...block, sort_order: block.sort_order ?? prev.length, can_edit: true }]
        : prev.map((b) => (b.id === editingId ? { ...b, ...block } : b)))
      setEditingId(null)
      toast.success(isNew ? 'Теория создана и подключена' : 'Теория сохранена')
    } finally {
      setSaving(false)
    }
  }

  async function unlink(blockId: string) {
    const res = await fetch(`/api/tests/${testId}/theory/${blockId}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error ?? 'Не удалось отключить теорию')
      return
    }
    setBlocks((prev) => prev.filter((b) => b.id !== blockId))
    toast.success('Теория отключена от задания (в библиотеке осталась)')
  }

  // Порядок блоков = порядок вкладок у ученика. Меняем сразу на экране,
  // при ошибке сохранения возвращаем как было.
  async function move(blockId: string, dir: -1 | 1) {
    const i = blocks.findIndex((b) => b.id === blockId)
    const j = i + dir
    if (i < 0 || j < 0 || j >= blocks.length) return
    const prev = blocks
    const next = [...blocks]
    ;[next[i], next[j]] = [next[j], next[i]]
    setBlocks(next)
    const res = await fetch(`/api/tests/${testId}/theory`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: next.map((b) => b.id) }),
    })
    if (!res.ok) {
      setBlocks(prev)
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? 'Не удалось изменить порядок')
    }
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <BookOpen className="h-5 w-5 text-sky-600" />
          Теория{blocks.length > 0 ? ` (${blocks.length})` : ''}
        </h2>
        {canEditTest && editingId === null && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
              <Library className="mr-1.5 h-4 w-4" /> Из библиотеки
            </Button>
            <Button size="sm" variant="outline" onClick={() => startEdit()}>
              <Plus className="mr-1.5 h-4 w-4" /> Создать
            </Button>
          </div>
        )}
      </div>

      {blocks.length === 0 && editingId === null && (
        <p className="text-sm text-muted-foreground">
          Теории пока нет. Ученик увидит её над заданиями и по кнопке «Теория» во время решения.{' '}
          <Link href="/teacher/theory" className="text-primary hover:underline">Библиотека теории</Link>
        </p>
      )}

      {blocks.length > 1 && editingId === null && (
        <p className="text-xs text-muted-foreground">
          У ученика блоки идут вкладками в этом порядке: «1. …», «2. …».
        </p>
      )}

      {blocks.map((b, i) => editingId === b.id ? null : (
        <div key={b.id} className="rounded-lg border">
          <div className="flex items-center gap-2 px-4 py-2.5">
            <button type="button" onClick={() => toggleExpanded(b.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
              {expanded.has(b.id) ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
              <span className="truncate text-sm font-medium">{blocks.length > 1 ? `${i + 1}. ` : ''}{b.title}</span>
              {b.grade && <Badge variant="outline" className="hidden shrink-0 text-[11px] sm:inline-flex">{b.grade} кл.</Badge>}
              {b.tags.slice(0, 3).map((t) => (
                <span key={t} className="hidden shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] text-sky-800 md:inline dark:bg-sky-950 dark:text-sky-200">{t}</span>
              ))}
            </button>
            {canEditTest && editingId === null && blocks.length > 1 && (
              <>
                <Button size="sm" variant="ghost" className="px-1.5" onClick={() => move(b.id, -1)} disabled={i === 0} title="Выше">
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" className="px-1.5" onClick={() => move(b.id, 1)} disabled={i === blocks.length - 1} title="Ниже">
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </>
            )}
            {b.can_edit && editingId === null && (
              <Button size="sm" variant="ghost" onClick={() => startEdit(b)} title="Редактировать блок (изменится во всех заданиях)">
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canEditTest && editingId === null && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" title="Отключить от задания">
                    <Unlink className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Отключить теорию «{b.title}»?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Ученики перестанут видеть её в этом задании. Сам блок останется в библиотеке теории.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Отмена</AlertDialogCancel>
                    <AlertDialogAction onClick={() => unlink(b.id)}>Отключить</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          {expanded.has(b.id) && (
            <div className="border-t px-4 py-4">
              <TheoryBlocksView blocks={[b]} />
            </div>
          )}
        </div>
      ))}

      {editingId !== null && (
        <div className="rounded-lg border bg-muted/20 p-4">
          <p className="mb-3 text-xs text-muted-foreground">
            {editingId === 'new'
              ? 'Новый блок попадёт в библиотеку теории и сразу подключится к этому заданию.'
              : 'Правка блока будет видна во всех заданиях, где он подключён.'}
          </p>
          <TheoryForm
            value={draft}
            onChange={setDraft}
            onSubmit={save}
            onCancel={() => setEditingId(null)}
            saving={saving}
            submitLabel={editingId === 'new' ? 'Создать и подключить' : 'Сохранить'}
            subjectOptions={testSubject ? [testSubject] : []}
          />
        </div>
      )}

      <TheoryPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        testId={testId}
        linkedIds={blocks.map((b) => b.id)}
        defaultSubject={testSubject}
        defaultGrade={testGrade}
        onLinked={(block) => setBlocks((prev) => prev.some((b) => b.id === block.id)
          ? prev
          : [...prev, { ...block, can_edit: viewerIsAdmin || (!!viewerId && block.created_by === viewerId) }])}
      />
    </div>
  )
}
