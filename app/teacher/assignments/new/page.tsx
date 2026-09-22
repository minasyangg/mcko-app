'use client'

import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowLeft, Loader2, AlertTriangle } from 'lucide-react'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { visibleTopicsInTreeOrder, type RoadmapTopicRow } from '@/lib/roadmaps/topic-order'
import Link from 'next/link'

const schema = z.object({
  test_id: z.string().min(1, 'Выберите тест'),
  target_type: z.enum(['roadmap_topic', 'group', 'student']),
  roadmap_topic_id: z.string().optional(),
  group_id: z.string().optional(),
  student_id: z.string().optional(),
  starts_at: z.string().optional(),
  ends_at: z.string().optional(),
  max_attempts: z.number().min(1, 'Минимум 1 попытка'),
  preserve_answers: z.boolean(),
}).superRefine((d, ctx) => {
  if (d.target_type === 'roadmap_topic' && !d.roadmap_topic_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Выберите тему программы', path: ['roadmap_topic_id'] })
  }
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
interface RoadmapOption { id: string; title: string }
interface TopicOption { value: string; label: string; hint: string; roadmapId: string }

export default function NewAssignmentPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tests, setTests] = useState<TestOption[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])
  const [students, setStudents] = useState<StudentOption[]>([])
  const [topicOptions, setTopicOptions] = useState<TopicOption[]>([])

  // Тест уже выбран, если экран открыт кнопкой «Назначить» из карточки
  // теста (?test=<id>) — устраняет живую жалобу пользователя: параметр в
  // URL уже передавался с 2026-09-х (TestDetailClient.tsx), но эта форма
  // никогда не читала searchParams и требовала выбрать тест заново.
  const presetTestId = searchParams.get('test') ?? undefined

  const { register, handleSubmit, control, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      test_id: presetTestId,
      // По умолчанию — «Программа» (решение пользователя, 2026-09-23);
      // если у учителя нет ни одной программы с видимой темой — переключаем
      // на «Группе» после загрузки данных (см. эффект ниже), не оставляем
      // пользователя перед пустым списком тем без выхода.
      target_type: 'roadmap_topic',
      max_attempts: 1,
      preserve_answers: false,
    },
  })
  const targetType = watch('target_type')
  const testId = watch('test_id')
  const studentId = watch('student_id')
  const groupId = watch('group_id')
  const roadmapTopicId = watch('roadmap_topic_id')

  // roadmapId → его системная группа (roadmaps.group_id) — используется
  // ниже для already-taken/duplicates и не хранится в форме напрямую
  // (форма шлёт roadmap_topic_id, сервер сам резолвит группу при вставке).
  const [groupIdByRoadmap, setGroupIdByRoadmap] = useState<Record<string, string>>({})

  // «Этот тест уже проходили» — информационно: назначить повторно можно
  // (например, для отработки), поэтому кнопку не блокируем.
  const [alreadyTaken, setAlreadyTaken] = useState<
    { student_name: string; score: number | null; max_score: number | null; submitted_at: string | null }[]
  >([])

  // already-taken/duplicates сверяются по «фактическому получателю» —
  // для программы это системная группа программы (roadmaps.group_id), не
  // сам roadmap_topic_id (той сущности API проверки не знают).
  const topicGroupId = topicOptions.find(t => t.value === roadmapTopicId)?.roadmapId
    ? groupIdByRoadmap[topicOptions.find(t => t.value === roadmapTopicId)!.roadmapId]
    : undefined

  useEffect(() => {
    const target = targetType === 'group' ? groupId : targetType === 'student' ? studentId : topicGroupId
    if (!testId || !target) { setAlreadyTaken([]); return }
    let cancelled = false
    fetch('/api/assignments/already-taken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        test_id: testId,
        ...(targetType === 'student' ? { student_id: target } : { group_id: target }),
      }),
    })
      .then(r => r.ok ? r.json() : { taken: [] })
      .then(d => { if (!cancelled) setAlreadyTaken(d.taken ?? []) })
      .catch(() => { if (!cancelled) setAlreadyTaken([]) })
    return () => { cancelled = true }
  }, [testId, studentId, groupId, topicGroupId, targetType])

  // «Задачи из этого ДЗ уже задавались» — сверка по каждой задаче теста
  // (см. /api/assignments/duplicates, миграция 052). В отличие от
  // alreadyTaken (тест целиком), это про пересечение НАБОРА задач с уже
  // заданными — то самое «сверка в реальный момент назначения», о которой
  // просил пользователь: пока ДЗ не назначено никому, сравнивать не с кем.
  //
  // Ученику — показываем список совпадений напрямую. Группе/программе —
  // сервер сам решает, стоит ли вообще предупреждать (пороги: >50%
  // учеников группы имеют личное пересечение >30% задач теста), чтобы один
  // ученик с полным повтором в группе из 20 не выглядел как «всем это уже
  // задавали».
  const [studentDups, setStudentDups] = useState<
    { student_name: string; test_title: string; assigned_at: string }[]
  >([])
  const [groupWarning, setGroupWarning] = useState<
    { affected_students: number; total_students: number; avg_overlap_percent: number } | null
  >(null)

  useEffect(() => {
    const target = targetType === 'group' ? groupId : targetType === 'student' ? studentId : topicGroupId
    if (!testId || !target) { setStudentDups([]); setGroupWarning(null); return }
    let cancelled = false
    fetch('/api/assignments/duplicates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        test_id: testId,
        ...(targetType === 'student' ? { student_id: target } : { group_id: target }),
      }),
    })
      .then(r => r.ok ? r.json() : { duplicates: [], group_warning: null })
      .then(d => {
        if (cancelled) return
        setStudentDups(targetType === 'student' ? (d.duplicates ?? []) : [])
        setGroupWarning(targetType !== 'student' ? (d.group_warning ?? null) : null)
      })
      .catch(() => { if (!cancelled) { setStudentDups([]); setGroupWarning(null) } })
    return () => { cancelled = true }
  }, [testId, studentId, groupId, topicGroupId, targetType])

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
        const [{ data: testsData }, { data: grps }, { data: studs }, { data: roadmaps }] = await Promise.all([
          supabase.from('tests').select('id, title')
            .eq('organization_id', org).eq('status', 'published').eq('is_active', true)
            .not('current_published_version_id', 'is', null).order('created_at', { ascending: false }),
          supabase.from('groups').select('id, name').eq('organization_id', org).is('roadmap_id', null).order('name'),
          supabase.from('profiles').select('id, full_name, grade')
            .eq('role', 'student').eq('organization_id', org).order('full_name'),
          // Свои программы — созданные этим учителем (та же граница
          // владения, что authorizeRoadmap проверяет для прямого редактора
          // программы, здесь просто список для выбора, не мутация).
          supabase.from('roadmaps').select('id, title, group_id').eq('created_by', user.id).order('title'),
        ])

        setTests(testsData ?? [])
        setGroups(grps ?? [])
        setStudents(studs ?? [])

        const roadmapList = (roadmaps ?? []) as (RoadmapOption & { group_id: string | null })[]
        const gMap: Record<string, string> = {}
        for (const r of roadmapList) if (r.group_id) gMap[r.id] = r.group_id
        setGroupIdByRoadmap(gMap)

        if (roadmapList.length > 0) {
          const { data: topics } = await supabase
            .from('roadmap_topics')
            .select('id, roadmap_id, parent_id, title, sort_order, visible_to_students')
            .in('roadmap_id', roadmapList.map(r => r.id))

          const options: TopicOption[] = []
          for (const r of roadmapList) {
            const entries = visibleTopicsInTreeOrder((topics ?? []) as RoadmapTopicRow[], r.id)
            for (const { topic, ancestorTitles } of entries) {
              const path = [r.title, ...ancestorTitles].join(' → ')
              options.push({ value: topic.id, label: topic.title, hint: path, roadmapId: r.id })
            }
          }
          setTopicOptions(options)
          // Ни одной видимой темы ни в одной программе — «Программа» по
          // умолчанию оставила бы пользователя перед пустым списком без
          // выхода (кроме ручного переключения типа). Переключаем на
          // «Группе», решение пользователя 2026-09-23.
          if (options.length === 0) setValue('target_type', 'group')
        } else {
          setValue('target_type', 'group')
        }
      } catch {
        setLoadError('Ошибка загрузки данных')
      } finally {
        setLoading(false)
      }
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
                {/* Тесты приходят отсортированными по дате создания, поэтому
                    первые в списке — недавно созданные: их назначают чаще всего */}
                <Controller name="test_id" control={control} render={({ field }) => (
                  <SearchableSelect
                    options={tests.map(t => ({ value: t.id, label: t.title }))}
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    placeholder="Выберите тест"
                    recentLabel="Недавно созданные"
                    emptyText="Нет опубликованных тестов"
                  />
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
                      // Сбрасываем поля неактивных вариантов при переключении
                      if (v !== 'roadmap_topic') setValue('roadmap_topic_id', undefined)
                      if (v !== 'group') setValue('group_id', undefined)
                      if (v !== 'student') setValue('student_id', undefined)
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="roadmap_topic">Программе</SelectItem>
                      <SelectItem value="group">Группе</SelectItem>
                      <SelectItem value="student">Ученику</SelectItem>
                    </SelectContent>
                  </Select>
                )} />
              </div>

              {/* Программа/тема — всегда в DOM, скрыта CSS */}
              <div className={targetType !== 'roadmap_topic' ? 'hidden' : 'space-y-1'}>
                <Label>Тема программы *</Label>
                <Controller name="roadmap_topic_id" control={control} render={({ field }) => (
                  <SearchableSelect
                    options={topicOptions}
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    placeholder="Выберите тему"
                    recentCount={0}
                    emptyText={
                      topicOptions.length === 0
                        ? 'Нет программ с открытыми ученикам темами — создайте программу или откройте тему в её редакторе'
                        : 'Ничего не найдено'
                    }
                  />
                )} />
                <p className="text-xs text-muted-foreground">
                  Показаны только темы, открытые ученикам (см. значок глазка в редакторе программы).
                  Назначение попадёт всем ученикам программы.
                </p>
                {errors.roadmap_topic_id && <p className="text-sm text-destructive">{errors.roadmap_topic_id.message}</p>}
              </div>

              {/* Группа — всегда в DOM, скрыта CSS */}
              <div className={targetType !== 'group' ? 'hidden' : 'space-y-1'}>
                <Label>Группа *</Label>
                <Controller name="group_id" control={control} render={({ field }) => (
                  <SearchableSelect
                    options={groups.map(g => ({ value: g.id, label: g.name }))}
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    placeholder="Выберите группу"
                    recentCount={0}
                    emptyText="Нет групп — создайте сначала"
                  />
                )} />
                {errors.group_id && <p className="text-sm text-destructive">{errors.group_id.message}</p>}
              </div>

              {/* Ученик — всегда в DOM, скрыт CSS */}
              <div className={targetType !== 'student' ? 'hidden' : 'space-y-1'}>
                <Label>Ученик *</Label>
                <Controller name="student_id" control={control} render={({ field }) => (
                  <SearchableSelect
                    options={students.map(s => ({
                      value: s.id,
                      label: s.full_name,
                      badge: s.grade ? `${s.grade} кл.` : null,
                    }))}
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    placeholder="Выберите ученика"
                    // Учеников много и порядок алфавитный — «последние» тут
                    // не имеют смысла, помогает именно поиск
                    recentCount={0}
                    emptyText="Нет учеников в организации"
                  />
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

              {/* Оба предупреждения информационные, кнопку не блокируют — повтор
                  может быть осознанным решением учителя (отработка, повторение).
                  Объединены в один блок секциями, а не два отдельных amber-бокса
                  подряд: касаются одного и того же выбора теста+адресата. */}
              {(alreadyTaken.length > 0 || studentDups.length > 0 || groupWarning) && (
                <div className="space-y-2.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm dark:border-amber-900 dark:bg-amber-950/40">
                  {alreadyTaken.length > 0 && (
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <div className="min-w-0 text-amber-900 dark:text-amber-200">
                        <div className="font-medium">Этот тест уже проходили</div>
                        <ul className="mt-1 space-y-0.5 text-amber-800/90 dark:text-amber-200/80">
                          {alreadyTaken.slice(0, 5).map((t, i) => (
                            <li key={i} className="truncate">
                              {t.student_name}
                              {t.score != null ? ` — ${t.score}/${t.max_score ?? '?'}` : ''}
                              {t.submitted_at ? `, ${new Date(t.submitted_at).toLocaleDateString('ru-RU')}` : ''}
                            </li>
                          ))}
                          {alreadyTaken.length > 5 && <li>…и ещё {alreadyTaken.length - 5}</li>}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* Ученик: показываем сам факт и где именно уже встречалась задача */}
                  {studentDups.length > 0 && (
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <div className="min-w-0 text-amber-900 dark:text-amber-200">
                        <div className="font-medium">
                          В этом ДЗ есть задачи, которые ученику уже задавали
                        </div>
                        <ul className="mt-1 space-y-0.5 text-amber-800/90 dark:text-amber-200/80">
                          {studentDups.slice(0, 5).map((d, i) => (
                            <li key={i} className="truncate">
                              «{d.test_title}»{d.assigned_at ? `, ${new Date(d.assigned_at).toLocaleDateString('ru-RU')}` : ''}
                            </li>
                          ))}
                          {studentDups.length > 5 && <li>…и ещё {studentDups.length - 5}</li>}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* Группа/программа: не по задачам и не по ученикам поимённо —
                      сводка, мягкое предупреждение только при выходе за оба
                      порога (см. GROUP_MIN_STUDENT_SHARE/GROUP_MIN_OVERLAP_SHARE) */}
                  {groupWarning && (
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <div className="min-w-0 text-amber-900 dark:text-amber-200">
                        <div className="font-medium">Похоже, это ДЗ во многом повторяет уже заданное</div>
                        <p className="mt-1 text-amber-800/90 dark:text-amber-200/80">
                          У {groupWarning.affected_students} из {groupWarning.total_students} учеников
                          в среднем {groupWarning.avg_overlap_percent}% задач этого ДЗ уже
                          встречались в других заданиях.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

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
