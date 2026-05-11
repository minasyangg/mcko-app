import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Plus, Users } from 'lucide-react'
import { DeleteGroupButton } from '@/components/teacher/DeleteGroupButton'

export default async function GroupsPage() {
  const supabase = await createClient()

  const { data: groups } = await supabase
    .from('groups')
    .select('id, name, description, created_at')
    .order('created_at', { ascending: false })

  // Count members per group
  const groupIds = (groups ?? []).map((g) => g.id)
  const { data: memberCounts } = groupIds.length
    ? await supabase
        .from('group_members')
        .select('group_id')
        .in('group_id', groupIds)
    : { data: [] }

  const countMap: Record<string, number> = {}
  for (const m of memberCounts ?? []) {
    countMap[m.group_id] = (countMap[m.group_id] ?? 0) + 1
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Группы</h1>
          <p className="text-sm text-muted-foreground mt-1">Классы и учебные группы</p>
        </div>
        <Button asChild>
          <Link href="/teacher/groups/new">
            <Plus className="h-4 w-4 mr-2" />
            Создать группу
          </Link>
        </Button>
      </div>

      {!groups?.length ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
          <Users className="h-10 w-10 opacity-40" />
          <p>Нет групп. Создайте первую группу.</p>
          <Button asChild variant="outline">
            <Link href="/teacher/groups/new">Создать группу</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <Card key={group.id} className="flex flex-col">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{group.name}</CardTitle>
                {group.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {group.description}
                  </p>
                )}
              </CardHeader>
              <CardContent className="flex items-center justify-between mt-auto pt-2">
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {countMap[group.id] ?? 0} учеников
                </span>
                <div className="flex items-center gap-1">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/teacher/groups/${group.id}`}>Открыть</Link>
                  </Button>
                  <DeleteGroupButton groupId={group.id} groupName={group.name} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
