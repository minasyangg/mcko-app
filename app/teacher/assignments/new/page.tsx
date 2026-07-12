'use client'

import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowLeft, Loader2 } from 'lucide-react'
import Link from 'next/link'

const schema = z.object({
  test_id: z.string().min(1, 'Выберите тест'),
  target_type: z.enum(['group', 'student']),
  group_id: z.string().optional(),
  student_id: z.string().optional(),
  starts_at: z.string().optional(),
  ends_at: z.string().optional(),
  max_attempts: z.number().min(1, 'Минимум 1 попытка'),
  preserve_answers: z.boolean(),
}).superRefine((d, ctx) => {
  if (d.target_type === 'group' && !d.group_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Выберите группу', path: ['group_id'] })
  }
  if (d.target_type === 'student' && !d.student_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Выберите ученика', path: ['student_id'] })
  }
})

type FormData = z.infer<typeof schema>

interface TestOption { id: string; title: string }
interface GroupOption { id: string; name: string }
interface StudentOption { id: string; full_name: string; grade: string | null }

export default function NewAssignmentPage() {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tests, setTests] = useState<TestOption[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])
  const [students, setStudents] = useState<StudentOption[]>([])

  const { register, handleSubmit, control, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { target_type: 'group', max_attempts: 1, preserve_answers: false },
  })
  const targetType = watch('target_type')

  useEffect(() => {
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setLoadError('Не авторизован'); return }

        const { data: profile } = await supabase
          .from('profiles').select('organization_id').eq('id', user.id).single()

        if (!profile?.organization_id) {
          setLoadError('Профиль не привязан к организации. Обратитесь к администратору.')
          return
        }

        const org = profile.organization_id
        const [{ data: testsData }, { data: grps }, { data: studs }] = await Promise.all([
          supabase.from('tests').select('id, title')
            .eq('organization_id', org).eq('status', 'published').eq('is_active', true)
            .not('current_published_version_id', 'is', null).order('title'),
          supabase.from('groups').select('id, name').eq('organization_id', org).is('roadmap_id', null).order('name'),
          supabase.from('profiles').select('id, full_name, grade')
            .eq('role', 'student').eq('organization_id', org).order('full_name'),
        ])

        setTests(testsData ?? [])
        setGroups(grps ?? [])
        setStudents(studs ?? [])
      } catch {
        setLoadError('Ошибка загрузки данных')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function onSubmit(data: FormData) {
    const res = await fetch('/api/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const json = await res.json()
    if (!res.ok) {
      toast.error(json.error ?? 'Ошибка создания назначения')
      return
    }
    toast.success('Назначение создано')
    router.push('/teacher/assignments')
    router.refresh()
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/teacher/assignments"><ArrowLeft className="h-4 w-4 mr-1" />Назад</Link>
        </Button>
        <h1 className="text-2xl font-semibold">Назначить тест</h1>
      </div>

      {loadError && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
          <Loader2 className="h-4 w-4 animate-spin" />Загрузка...
        </div>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base">Параметры назначения</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

              {/* Тест */}
              <div className="space-y-1">
                <Label>Тест *</Label>
                <Controller name="test_id" control={control} render={({ field }) => (
                  <Select
                    value={field.value || undefined}
                    onValueChange={(v) => field.onChange(v)}
                  >
                    <SelectTrigger className={errors.test_id ? 'border-destructive' : ''}>
                      <SelectValue placeholder="Выберите тест" />
                    </SelectTrigger>
                    <SelectContent>
                      {tests.length === 0
                        ? <SelectItem value="_none" disabled>Нет опубликованных тестов</SelectItem>
                        : tests.map(t => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
                {errors.test_id && <p className="text-sm text-destructive">{errors.test_id.message}</p>}
              </div>

              {/* Кому назначить */}
              <div className="space-y-1">
                <Label>Назначить *</Label>
                <Controller name="target_type" control={control} render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v)
                      // Clear opposite field when switching
                      if (v === 'group') setValue('student_id', undefined)
                      if (v === 'student') setValue('group_id', undefined)
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="group">Группе</SelectItem>
                      <SelectItem value="student">Ученику</SelectItem>
                    </SelectContent>
                  </Select>
                )} />
              </div>

              {/* Группа — всегда в DOM, скрыта CSS */}
              <div className={targetType !== 'group' ? 'hidden' : 'space-y-1'}>
                <Label>Группа *</Label>
                <Controller name="group_id" control={control} render={({ field }) => (
                  <Select
                    value={field.value || undefined}
                    onValueChange={(v) => field.onChange(v)}
                  >
                    <SelectTrigger className={errors.group_id ? 'border-destructive' : ''}>
                      <SelectValue placeholder="Выберите группу" />
                    </SelectTrigger>
                    <SelectContent>
                      {groups.length === 0
                        ? <SelectItem value="_none" disabled>Нет групп — создайте сначала</SelectItem>
                        : groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
                {errors.group_id && <p className="text-sm text-destructive">{errors.group_id.message}</p>}
              </div>

              {/* Ученик — всегда в DOM, скрыт CSS */}
              <div className={targetType !== 'student' ? 'hidden' : 'space-y-1'}>
                <Label>Ученик *</Label>
                <Controller name="student_id" control={control} render={({ field }) => (
                  <Select
                    value={field.value || undefined}
                    onValueChange={(v) => field.onChange(v)}
                  >
                    <SelectTrigger className={errors.student_id ? 'border-destructive' : ''}>
                      <SelectValue placeholder="Выберите ученика" />
                    </SelectTrigger>
                    <SelectContent>
                      {students.length === 0
                        ? <SelectItem value="_none" disabled>Нет учеников в организации</SelectItem>
                        : students.map(s => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.full_name}{s.grade ? ` (${s.grade})` : ''}
                            </SelectItem>
                          ))}
                    </SelectContent>
                  </Select>
                )} />
                {errors.student_id && <p className="text-sm text-destructive">{errors.student_id.message}</p>}
              </div>

              {/* Даты */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="starts_at">Начало</Label>
                  <Input id="starts_at" type="datetime-local" {...register('starts_at')} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ends_at">Конец</Label>
                  <Input id="ends_at" type="datetime-local" {...register('ends_at')} />
                </div>
              </div>

              {/* Попытки */}
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label htmlFor="max_attempts">Количество попыток</Label>
                  <Input id="max_attempts" type="number" min={1} className="w-32"
                    {...register('max_attempts', { valueAsNumber: true })} />
                  {errors.max_attempts && <p className="text-sm text-destructive">{errors.max_attempts.message}</p>}
                </div>
                {/* Preserve answers — only shown when max_attempts > 1 */}
                {(watch('max_attempts') ?? 1) > 1 && (
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded border-input"
                      {...register('preserve_answers')}
                    />
                    <div>
                      <span className="text-sm font-medium">Перезаписываемые ответы</span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        При новой попытке ответ на вопрос, оставленный пустым, сохраняется из предыдущей попытки.
                      </p>
                    </div>
                  </label>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting || loading}>
                {isSubmitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Создание...</> : 'Создать назначение'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
