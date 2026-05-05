import { createClient } from '@/lib/supabase/server'
import { StudentsTableClient } from '@/components/teacher/StudentsTableClient'
import { Button } from '@/components/ui/button'
import { Users, Plus } from 'lucide-react'
import Link from 'next/link'

export default async function StudentsPage() {
  const supabase = await createClient()

  // First get current user to get organization
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return <div>Unauthorized</div>
  }

  // Get user profile to find organization
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  const { data: students } = await supabase
    .from('profiles')
    .select('id, full_name, grade, is_active, created_at, deleted_at')
    .eq('role', 'student')
    .eq('organization_id', profile?.organization_id || '')
    .order('deleted_at', { ascending: false, nullsFirst: true })
    .order('full_name', { ascending: true })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Ученики</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {students?.length ?? 0} ученик
            {(students?.length ?? 0) % 10 === 1 && (students?.length ?? 0) % 100 !== 11
              ? ''
              : (students?.length ?? 0) % 10 < 5 && !((students?.length ?? 0) % 100 >= 11 && (students?.length ?? 0) % 100 <= 19)
                ? 'а'
                : 'ов'}
          </p>
        </div>
        <Button asChild>
          <Link href="/teacher/students/new">
            <Plus className="h-4 w-4 mr-2" />
            Добавить ученика
          </Link>
        </Button>
      </div>

      {!students?.length ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
          <Users className="h-10 w-10 opacity-40" />
          <p>Нет зарегистрированных учеников.</p>
        </div>
      ) : (
        <StudentsTableClient
          students={(students || []) as Array<{ id: string; full_name: string; grade: string; is_active: boolean; created_at: string; deleted_at: string | null }>}
          onStudentDeleted={() => {
            // Trigger revalidation if needed
          }}
        />
      )}
    </div>
  )
}
