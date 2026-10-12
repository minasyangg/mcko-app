'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { BookOpen, ChevronDown, ChevronUp, Pencil, Plus, Trash2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import MarkdownContent from '@/components/shared/MarkdownContent'
import type { TheoryBlock } from '@/lib/theory/types'
import { TheoryBlocksView } from './TheoryBlocksView'

interface Props {
  testId: string
  initialBlocks: TheoryBlock[]
  /** Создатель теста или админ — те же права, что у правки самого теста */
  canEdit: boolean
}

interface Draft {
  title: string
  source_ref: string
  content_md: string
}

const EMPTY_DRAFT: Draft = { title: 'Теория', source_ref: '', content_md: '' }

// Блок «Теория» на странице теста у учителя. Теория не версионируется вместе
// с заданиями (миграция 098), поэтому её можно править и у опубликованного
// ДЗ — ученик сразу увидит исправление.
export function TheoryEditorPanel({ testId, initialBlocks, canEdit }: Props) {
  const [blocks, setBlocks] = useState<TheoryBlock[]>(initialBlocks)
  // id редактируемого блока; 'new' — создание нового
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function startEdit(block?: TheoryBlock) {
    setEditingId(block?.id ?? 'new')
    setDraft(block
      ? { title: block.title, source_ref: block.source_ref ?? '', content_md: block.content_md }
      : EMPTY_DRAFT)
  }

  async function save() {
    if (!editingId) return
    setSaving(true)
    try {
      const isNew = editingId === 'new'
      const res = await fetch(
        isNew ? `/api/tests/${testId}/theory` : `/api/tests/${testId}/theory/${editingId}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: draft.title.trim() || 'Теория',
            source_ref: draft.source_ref.trim() || null,
            content_md: draft.content_md,
          }),
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? 'Не удалось сохранить теорию')
        return
      }
      setBlocks((prev) => isNew
        ? [...prev, data.block as TheoryBlock]
        : prev.map((b) => (b.id === editingId ? { ...b, ...(data.block as TheoryBlock) } : b)))
      setEditingId(null)
      toast.success('Теория сохранена')
    } finally {
      setSaving(false)
    }
  }

  async function remove(blockId: string) {
    const res = await fetch(`/api/tests/${testId}/theory/${blockId}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error ?? 'Не удалось удалить теорию')
      return
    }
    setBlocks((prev) => prev.filter((b) => b.id !== blockId))
    toast.success('Теория удалена')
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
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <BookOpen className="h-5 w-5 text-sky-600" />
          Теория{blocks.length > 0 ? ` (${blocks.length})` : ''}
        </h2>
        {canEdit && editingId === null && (
          <Button size="sm" variant="outline" onClick={() => startEdit()}>
            <Plus className="mr-1.5 h-4 w-4" />
            Добавить теорию
          </Button>
        )}
      </div>

      {blocks.length === 0 && editingId === null && (
        <p className="text-sm text-muted-foreground">
          Теории пока нет. Ученик увидит её над заданиями и по кнопке «Теория» во время решения.
        </p>
      )}

      {blocks.map((b) => editingId === b.id ? null : (
        <div key={b.id} className="rounded-lg border">
          <div className="flex items-center gap-2 px-4 py-2.5">
            <button
              type="button"
              onClick={() => toggleExpanded(b.id)}
              className="flex flex-1 items-center gap-2 text-left min-w-0"
            >
              {expanded.has(b.id) ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
              <span className="truncate text-sm font-medium">{b.title}</span>
              {b.source_ref && <span className="hidden truncate text-xs text-muted-foreground sm:inline">· {b.source_ref}</span>}
            </button>
            {canEdit && editingId === null && (
              <>
                <Button size="sm" variant="ghost" onClick={() => startEdit(b)} title="Редактировать">
                  <Pencil className="h-4 w-4" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="ghost" title="Удалить" className="text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Удалить теорию «{b.title}»?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Ученики перестанут видеть этот блок в ДЗ. Задания не изменятся.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Отмена</AlertDialogCancel>
                      <AlertDialogAction onClick={() => remove(b.id)}>Удалить</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
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
        <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Заголовок</Label>
              <Input
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Источник (необязательно)</Label>
              <Input
                value={draft.source_ref}
                onChange={(e) => setDraft((d) => ({ ...d, source_ref: e.target.value }))}
                placeholder="Учебник, ч. 1, §1–10, с. 5–46"
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Текст (Markdown, формулы в $…$, таблицы)</Label>
              <Textarea
                value={draft.content_md}
                onChange={(e) => setDraft((d) => ({ ...d, content_md: e.target.value }))}
                rows={20}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1 min-w-0">
              <Label className="text-xs">Как увидит ученик</Label>
              <div className="h-full max-h-[32rem] overflow-y-auto rounded-md border bg-background p-3">
                {draft.content_md.trim()
                  ? <MarkdownContent content={draft.content_md} />
                  : <p className="text-sm text-muted-foreground">Здесь появится предпросмотр.</p>}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={saving || !draft.content_md.trim()}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Сохранить
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditingId(null)} disabled={saving}>
              Отмена
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
