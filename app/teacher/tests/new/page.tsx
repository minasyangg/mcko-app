'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'

const schema = z.object({
  title: z.string().min(1, 'Название обязательно'),
  subject: z.string().optional(),
  grade: z.string().optional(),
  exam_type: z.string().optional(),
  description: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

const EXAM_TYPES = ['ВПР', 'ОГЭ', 'ЕГЭ', 'МЦКО', 'Контрольная', 'Другое'] as const
const SUBJECTS = ['Математика', 'Физика', 'ТВИС', 'Русский язык'] as const

export default function NewTestPage() {
  const router = useRouter()
  // ?kind=homework — создание домашнего задания (баллы задаёт учитель),
  // по умолчанию — тест (разбаловка/критерии по правилам оценивания)
  const kind = useSearchParams().get('kind') === 'homework' ? 'homework' : 'test'
  const isHomework = kind === 'homework'
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      subject: '',
      grade: '',
      exam_type: '',
      description: '',
    },
  })

  const examTypeValue = watch('exam_type')
  const subjectValue = watch('subject')

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true)
    setError(null)

    try {
      const supabase = createClient()

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser()
      if (authError || !user) {
        throw new Error('Не авторизован')
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()
      if (profileError || !profile?.organization_id) {
        throw new Error('Не удалось получить организацию пользователя')
      }

      const { data: test, error: testError } = await supabase
        .from('tests')
        .insert({
          title: values.title,
          subject: values.subject || null,
          grade: values.grade || null,
          exam_type: values.exam_type || null,
          description: values.description || null,
          organization_id: profile.organization_id,
          created_by: user.id,
          status: 'draft',
          kind,
        })
        .select('id')
        .single()
      if (testError || !test) {
        throw new Error(testError?.message || 'Ошибка создания теста')
      }

      const { data: testVersion, error: versionError } = await supabase
        .from('test_versions')
        .insert({
          test_id: test.id,
          version_number: 1,
          status: 'draft',
        })
        .select('id')
        .single()
      if (versionError || !testVersion) {
        throw new Error(versionError?.message || 'Ошибка создания версии теста')
      }

      router.push(`/teacher/tests/${test.id}/import`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="mb-6">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link href="/teacher/tests">← Назад к заданиям</Link>
        </Button>
        <h1 className="text-2xl font-semibold">
          {isHomework ? 'Создать домашнее задание' : 'Создать новый тест'}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isHomework
            ? 'Домашнее задание — баллы задаёте вы сами при составлении или назначении'
            : 'Заполните информацию о тесте, затем загрузите PDF с заданиями'}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Информация о тесте</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="title">
                Название <span className="text-destructive">*</span>
              </Label>
              <Input
                id="title"
                placeholder="Например: Контрольная работа по алгебре №3"
                {...register('title')}
              />
              {errors.title && (
                <p className="text-sm text-destructive">{errors.title.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="subject">Предмет</Label>
                <Select
                  value={subjectValue || '_none'}
                  onValueChange={(val) => setValue('subject', val === '_none' ? '' : val)}
                >
                  <SelectTrigger id="subject">
                    <SelectValue placeholder="Выберите предмет..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— Не указан —</SelectItem>
                    {SUBJECTS.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="grade">Класс</Label>
                <Input id="grade" placeholder="9, 11..." {...register('grade')} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="exam_type">Тип экзамена</Label>
              <Select
                value={examTypeValue || '_none'}
                onValueChange={(val) => setValue('exam_type', val === '_none' ? '' : val)}
              >
                <SelectTrigger id="exam_type">
                  <SelectValue placeholder="Выберите тип..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— Не указан —</SelectItem>
                  {EXAM_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Описание</Label>
              <Textarea
                id="description"
                placeholder="Дополнительная информация о тесте..."
                rows={3}
                {...register('description')}
              />
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 text-destructive text-sm px-4 py-3">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Создание...' : 'Создать и загрузить PDF'}
              </Button>
              <Button asChild type="button" variant="outline">
                <Link href="/teacher/tests">Отмена</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
