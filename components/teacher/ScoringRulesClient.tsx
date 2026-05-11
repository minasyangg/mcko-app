'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, Pencil, Save, X, ChevronDown, ChevronUp } from 'lucide-react'

interface RuleItem {
  id?: string
  task_number: number
  max_score: number
  note?: string | null
}

interface Rule {
  id: string
  name: string
  exam_type: string | null
  grade: string | null
  subject: string | null
  scoring_rule_items: RuleItem[]
}

interface Props {
  initialRules: Rule[]
}

const EXAM_TYPES = ['ВПР', 'ОГЭ', 'ЕГЭ', 'КР', 'СР', 'Другое']

function RuleForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<Rule>
  onSave: (data: { name: string; exam_type: string; grade: string; subject: string; items: RuleItem[] }) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [examType, setExamType] = useState(initial?.exam_type ?? '')
  const [grade, setGrade] = useState(initial?.grade ?? '')
  const [subject, setSubject] = useState(initial?.subject ?? '')
  const [items, setItems] = useState<RuleItem[]>(
    initial?.scoring_rule_items?.length
      ? [...initial.scoring_rule_items].sort((a, b) => a.task_number - b.task_number)
      : [{ task_number: 1, max_score: 1 }]
  )
  const [saving, setSaving] = useState(false)

  const addItem = () => {
    const next = Math.max(...items.map(i => i.task_number), 0) + 1
    setItems(prev => [...prev, { task_number: next, max_score: 1 }])
  }

  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx))

  const updateItem = (idx: number, field: keyof RuleItem, value: string | number) =>
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))

  const totalMax = items.reduce((s, i) => s + Number(i.max_score), 0)

  const handleSubmit = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave({ name, exam_type: examType, grade, subject, items })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <Label>Название правила *</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="ВПР Математика 8 класс" className="mt-1" />
        </div>
        <div>
          <Label>Тип теста</Label>
          <select
            value={examType}
            onChange={e => setExamType(e.target.value)}
            className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">— любой —</option>
            {EXAM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <Label>Класс</Label>
          <Input value={grade} onChange={e => setGrade(e.target.value)} placeholder="8" className="mt-1" />
        </div>
        <div className="sm:col-span-2">
          <Label>Предмет</Label>
          <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Математика" className="mt-1" />
        </div>
      </div>

      {/* Task score table */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>Баллы по заданиям</Label>
          <span className="text-xs text-muted-foreground">Итого максимум: <strong>{totalMax}</strong> б.</span>
        </div>
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 font-medium w-24">№ задания</th>
                <th className="text-left px-3 py-2 font-medium w-32">Макс. балл</th>
                <th className="text-left px-3 py-2 font-medium">Примечание</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item, idx) => (
                <tr key={idx} className="group">
                  <td className="px-3 py-1.5">
                    <Input
                      type="number" min={1}
                      value={item.task_number}
                      onChange={e => updateItem(idx, 'task_number', parseInt(e.target.value) || 1)}
                      className="h-7 w-20"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <Input
                      type="number" min={0} step={0.5}
                      value={item.max_score}
                      onChange={e => updateItem(idx, 'max_score', parseFloat(e.target.value) || 0)}
                      className="h-7 w-24"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <Input
                      value={item.note ?? ''}
                      onChange={e => updateItem(idx, 'note', e.target.value)}
                      placeholder="необязательно"
                      className="h-7"
                    />
                  </td>
                  <td className="px-2">
                    <button type="button" onClick={() => removeItem(idx)} className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-opacity">
                      <X className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addItem} className="mt-2 gap-1">
          <Plus className="h-3.5 w-3.5" />
          Добавить задание
        </Button>
      </div>

      <div className="flex gap-2">
        <Button onClick={handleSubmit} disabled={saving || !name.trim()} size="sm">
          <Save className="h-4 w-4 mr-1.5" />
          {saving ? 'Сохранение...' : 'Сохранить'}
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel}>Отмена</Button>
      </div>
    </div>
  )
}

export function ScoringRulesClient({ initialRules }: Props) {
  const [rules, setRules] = useState<Rule[]>(initialRules)
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const handleCreate = async (data: Parameters<Parameters<typeof RuleForm>[0]['onSave']>[0]) => {
    const res = await fetch('/api/scoring-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (res.ok) {
      const { id } = await res.json()
      const newRule: Rule = {
        id,
        name: data.name,
        exam_type: data.exam_type || null,
        grade: data.grade || null,
        subject: data.subject || null,
        scoring_rule_items: data.items.map((item, i) => ({ ...item, id: String(i) })),
      }
      setRules(prev => [newRule, ...prev])
      setShowCreate(false)
    }
  }

  const handleUpdate = async (id: string, data: Parameters<Parameters<typeof RuleForm>[0]['onSave']>[0]) => {
    const res = await fetch(`/api/scoring-rules/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (res.ok) {
      setRules(prev => prev.map(r => r.id === id ? {
        ...r,
        name: data.name,
        exam_type: data.exam_type || null,
        grade: data.grade || null,
        subject: data.subject || null,
        scoring_rule_items: data.items,
      } : r))
      setEditingId(null)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить правило оценивания?')) return
    const res = await fetch(`/api/scoring-rules/${id}`, { method: 'DELETE' })
    if (res.ok) setRules(prev => prev.filter(r => r.id !== id))
  }

  return (
    <div className="space-y-4">
      {showCreate ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Новое правило</CardTitle></CardHeader>
          <CardContent>
            <RuleForm
              onSave={handleCreate}
              onCancel={() => setShowCreate(false)}
            />
          </CardContent>
        </Card>
      ) : (
        <Button onClick={() => setShowCreate(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Создать правило
        </Button>
      )}

      {rules.length === 0 && !showCreate && (
        <p className="text-sm text-muted-foreground text-center py-8">
          Правил пока нет. Создайте первое правило для автоматического применения баллов при обработке тестов.
        </p>
      )}

      {rules.map(rule => (
        <Card key={rule.id}>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base">{rule.name}</CardTitle>
                {rule.exam_type && <Badge variant="secondary">{rule.exam_type}</Badge>}
                {rule.grade && <Badge variant="outline">{rule.grade} кл.</Badge>}
                {rule.subject && <span className="text-sm text-muted-foreground">{rule.subject}</span>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => setExpandedId(expandedId === rule.id ? null : rule.id)} className="p-1 hover:bg-muted rounded transition-colors">
                  {expandedId === rule.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                <button onClick={() => setEditingId(editingId === rule.id ? null : rule.id)} className="p-1 hover:bg-muted rounded transition-colors">
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => handleDelete(rule.id)} className="p-1 hover:bg-destructive/10 text-destructive rounded transition-colors">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {rule.scoring_rule_items.length} заданий · максимум {rule.scoring_rule_items.reduce((s, i) => s + Number(i.max_score), 0)} баллов
            </p>
          </CardHeader>

          {editingId === rule.id && (
            <CardContent className="border-t pt-4">
              <RuleForm
                initial={rule}
                onSave={(data) => handleUpdate(rule.id, data)}
                onCancel={() => setEditingId(null)}
              />
            </CardContent>
          )}

          {expandedId === rule.id && editingId !== rule.id && (
            <CardContent className="border-t pt-3">
              <div className="rounded border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">№</th>
                      <th className="text-left px-3 py-2 font-medium">Макс. балл</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Примечание</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {[...rule.scoring_rule_items].sort((a, b) => a.task_number - b.task_number).map(item => (
                      <tr key={item.id}>
                        <td className="px-3 py-1.5 font-mono">{item.task_number}</td>
                        <td className="px-3 py-1.5 font-semibold">{item.max_score}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{item.note ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  )
}
