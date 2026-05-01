import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Users } from 'lucide-react'
import { GroupMembersEditor } from '@/components/teacher/GroupMembersEditor'

interface Props {
  params: Promise<{ id: string }>
}

export default async function GroupDetailPage({ params }: Props) {
  const { id: groupId } = await params
  const supabase = await createClient()

  const { data: group } = await supabase
    .from('groups')
    .select('id, name, description, organization_id')
    .eq('id', groupId)
    .single()

  if (!group) redirect('/teacher/groups')

  const { data: members } = await supabase
    .from('group_members')
    .select('user_id, added_at, profiles(full_name, grade, role)')
    .eq('group_id', groupId)
    .order('added_at', { ascending: false })

  const { data: allStudents } = await supabase
    .from('profiles')
    .select('id, full_name, grade')
    .eq('role', 'student')
    .eq('organization_id', group.organization_id)
    .order('full_name')

  const memberIds = new Set((members ?? []).map((m) => m.user_id))
  const availableStudents = (allStudents ?? []).filter((s) => !memberIds.has(s.id))

  const memberList = (members ?? []).map((m) => {
    const profile = m.profiles as any
    return {
      user_id: m.user_id,
      added_at: m.added_at,
      profiles: {
        full_name: profile?.full_name ?? '—',
        grade: profile?.grade ?? null,
      },
    }
  })

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/teacher/groups">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Назад
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">{group.name}</h1>
          {group.description && (
            <p className="text-sm text-muted-foreground">{group.description}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          {memberList.length} участников
        </span>
      </div>

      <GroupMembersEditor
        groupId={groupId}
        initialMembers={memberList}
        availableStudents={availableStudents.map((s) => ({
          id: s.id,
          full_name: s.full_name,
          grade: s.grade,
        }))}
      />
    </div>
  )
}
