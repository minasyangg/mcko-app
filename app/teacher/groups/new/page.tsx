'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { AdminAuthorNotice } from '@/components/shared/AdminAuthorNotice'

const schema = z.object({
  name: z.string().min(1, 'Введите название группы'),
  description: z.string().optional(),
})
type FormData = z.infer<typeof schema>

export default function NewGroupPage() {
  const router = useRouter()
  const supabase = createClient()
  const [orgId, setOrgId] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    async function loadOrg() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()
      setOrgId(data?.organization_id ?? null)
    }
    loadOrg()
  }, [])

  async function onSubmit(data: FormData) {
    if (!orgId) {
      toast.error('Организация не найдена. Обратитесь к администратору.')
      return
    }
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('groups').insert({
      name: data.name,
      description: data.description || null,
      organization_id: orgId,
      created_by: user?.id,
    })
    if (error) {
      toast.error('Ошибка при создании группы')
      return
    }
    toast.success('Группа создана')
    router.push('/teacher/groups')
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/teacher/groups">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Назад
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">Новая группа</h1>
      </div>

      <div className="mb-4">
        <AdminAuthorNotice what="группа" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Данные группы</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="name">Название *</Label>
              <Input id="name" placeholder="Например: 10А" {...register('name')} />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="description">Описание</Label>
              <Textarea
                id="description"
                placeholder="Необязательно"
                rows={3}
                {...register('description')}
              />
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting || !orgId}>
              {isSubmitting ? 'Создание...' : 'Создать группу'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
