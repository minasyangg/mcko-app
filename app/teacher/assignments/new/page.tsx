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
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

const schema = z.object({
  test_version_id: z.string().uuid('Выберите тест'),
  target_type: z.enum(['group', 'student']),
  group_id: z.string().uuid().optional(),
  student_id: z.string().uuid().optional(),
  starts_at: z.string().optional(),
  ends_at: z.string().optional(),
  max_attempts: z.number().min(1),
}).refine(
  (d) => d.target_type === 'group' ? !!d.group_id : !!d.student_id,
  { message: 'Выберите группу или ученика', path: ['target_type'] }
)
type FormData = z.infer<typeof schema>

interface TestVersionOption { id: string; label: string }
interface GroupOption { id: string; name: string }
interface StudentOption { id: string; full_name: string; grade: string | null }

export default function NewAssignmentPage() {
  const router = useRouter()
  const supabase = createClient()
  const [orgId, setOrgId] = useState<string | null>(null)
  const [testVersions, setTestVersions] = useState<TestVersionOption[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])
  const [students, setStudents] = useState<StudentOption[]>([])

  const { register, handleSubmit, control, watch, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { target_type: 'group' as const, max_attempts: 1 },
  })
  const targetType = watch('target_type')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()
      const org = profile?.organization_id
      setOrgId(org ?? null)
      if (!org) return

      const [{ data: tvs }, { data: grps }, { data: studs }] = await Promise.all([
        supabase
          .from('test_versions')
          .select('id, version_number, tests(title)')
          .eq('status', 'published')
          .order('created_at', { ascending: false }),
        supabase.from('groups').select('id, name').eq('organization_id', org).order('name'),
        supabase.from('profiles').select('id, full_name, grade').eq('role', 'student').eq('organization_id', org).order('full_name'),
      ])
      setTestVersions((tvs ?? []).map((tv) => ({
        id: tv.id,
        label: `${(tv.tests as any)?.title ?? '—'} (v${tv.version_number})`,
      })))
      setGroups(grps ?? [])
      setStudents(studs ?? [])
    }
    load()
  }, [])

  async function onSubmit(data: FormData) {
    if (!orgId) { toast.error('Организация не найдена'); return }
    const { error } = await supabase.from('assignments').insert({
      test_version_id: data.test_version_id,
      organization_id: orgId,
      group_id: data.target_type === 'group' ? data.group_id : null,
      student_id: data.target_type === 'student' ? data.student_id : null,
      starts_at: data.starts_at || null,
      ends_at: data.ends_at || null,
      max_attempts: data.max_attempts,
    })
    if (error) { toast.error('Ошибка при создании назначения'); return }
    toast.success('Назначение создано')
    router.push('/teacher/assignments')
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/teacher/assignments"><ArrowLeft className="h-4 w-4 mr-1" />Назад</Link>
        </Button>
        <h1 className="text-2xl font-semibold">Назначить тест</h1>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Параметры назначения</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

            <div className="space-y-1">
              <Label>Тест *</Label>
              <Controller name="test_version_id" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue placeholder="Выберите тест" /></SelectTrigger>
                  <SelectContent>
                    {testVersions.length === 0
                      ? <SelectItem value="_none" disabled>Нет опубликованных тестов</SelectItem>
                      : testVersions.map((tv) => (
                          <SelectItem key={tv.id} value={tv.id}>{tv.label}</SelectItem>
                        ))}
                  </SelectContent>
                </Select>
              )} />
              {errors.test_version_id && <p className="text-sm text-destructive">{errors.test_version_id.message}</p>}
            </div>

            <div className="space-y-1">
              <Label>Назначить *</Label>
              <Controller name="target_type" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="group">Группе</SelectItem>
                    <SelectItem value="student">Ученику</SelectItem>
                  </SelectContent>
                </Select>
              )} />
            </div>

            {targetType === 'group' && (
              <div className="space-y-1">
                <Label>Группа *</Label>
                <Controller name="group_id" control={control} render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Выберите группу" /></SelectTrigger>
                    <SelectContent>
                      {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
              </div>
            )}

            {targetType === 'student' && (
              <div className="space-y-1">
                <Label>Ученик *</Label>
                <Controller name="student_id" control={control} render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Выберите ученика" /></SelectTrigger>
                    <SelectContent>
                      {students.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.full_name}{s.grade ? ` (${s.grade})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </div>
            )}

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

            <div className="space-y-1">
              <Label htmlFor="max_attempts">Кол-во попыток</Label>
              <Input id="max_attempts" type="number" min={1} {...register('max_attempts', { valueAsNumber: true })} className="w-32" />
            </div>

            {errors.target_type && <p className="text-sm text-destructive">{errors.target_type.message}</p>}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Создание...' : 'Создать назначение'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
