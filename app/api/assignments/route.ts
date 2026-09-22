import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import { zUuid } from '@/lib/uuid'
import { notifyAssignmentCreated } from '@/lib/notifications/send'

const schema = z.object({
  test_id: zUuid(),
  target_type: z.enum(['roadmap_topic', 'group', 'student']),
  roadmap_topic_id: zUuid().optional().nullable(),
  group_id: zUuid().optional().nullable(),
  student_id: zUuid().optional().nullable(),
  starts_at: z.string().optional().nullable(),
  ends_at: z.string().optional().nullable(),
  max_attempts: z.number().min(1).default(1),
  preserve_answers: z.boolean().default(false),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()

  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!profile.organization_id) {
    return NextResponse.json({ error: 'No organization' }, { status: 400 })
  }

  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  const { test_id, target_type, roadmap_topic_id, group_id, student_id, starts_at, ends_at, max_attempts, preserve_answers } = parsed.data

  if (target_type === 'roadmap_topic' && !roadmap_topic_id) {
    return NextResponse.json({ error: 'Выберите тему программы' }, { status: 400 })
  }
  if (target_type === 'group' && !group_id) {
    return NextResponse.json({ error: 'Выберите группу' }, { status: 400 })
  }
  if (target_type === 'student' && !student_id) {
    return NextResponse.json({ error: 'Выберите ученика' }, { status: 400 })
  }

  // Get the version ID for this test
  const admin = createAdminClient()
  const { data: test } = await admin
    .from('tests')
    .select('current_published_version_id, organization_id, created_by')
    .eq('id', test_id)
    .single()

  if (!test || test.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: 'Test not found' }, { status: 404 })
  }

  if (!test.current_published_version_id) {
    return NextResponse.json({ error: 'Тест не опубликован' }, { status: 400 })
  }

  // Назначение на тему программы доступно только учителю-владельцу
  // программы (тот же принцип, что authorizeRoadmap для прямого редактора
  // программы, lib/roadmaps/authorize.ts) — admin программы не редактирует
  // и не назначает через них, у него read-only «кабинет».
  let roadmapGroupId: string | null = null
  if (target_type === 'roadmap_topic' && roadmap_topic_id) {
    if (profile.role === 'admin') {
      return NextResponse.json({ error: 'Назначение по программе доступно только учителю-владельцу программы' }, { status: 403 })
    }
    const { data: topic } = await admin
      .from('roadmap_topics')
      .select('id, roadmap_id, visible_to_students, parent_id, roadmaps!inner(id, created_by, organization_id, group_id)')
      .eq('id', roadmap_topic_id)
      .single()
    const roadmap = topic?.roadmaps as unknown as { id: string; created_by: string; organization_id: string; group_id: string | null } | null
    if (!topic || !roadmap || roadmap.organization_id !== profile.organization_id) {
      return NextResponse.json({ error: 'Тема программы не найдена' }, { status: 404 })
    }
    if (roadmap.created_by !== user.id) {
      return NextResponse.json({ error: 'Назначать можно только в своих программах' }, { status: 403 })
    }
    if (!roadmap.group_id) {
      return NextResponse.json({ error: 'У программы нет группы' }, { status: 400 })
    }
    // Эффективная видимость темы (092) — AND по цепочке предков, тот же
    // принцип, что topicsInTreeOrder на стороне ученика (app/student/page.tsx):
    // назначать в скрытую тему бессмысленно, ученик её не увидит в
    // "Программе" вовсе, задание "потеряется" молча.
    type TopicVisibilityRow = { id: string; visible_to_students: boolean; parent_id: string | null }
    let cur: TopicVisibilityRow | null =
      { id: topic.id, visible_to_students: topic.visible_to_students, parent_id: topic.parent_id }
    while (cur) {
      if (!cur.visible_to_students) {
        return NextResponse.json({ error: 'Эта тема (или родительская) скрыта от учеников — сначала откройте её в редакторе программы' }, { status: 400 })
      }
      if (!cur.parent_id) break
      const { data: parent }: { data: TopicVisibilityRow | null } = await admin
        .from('roadmap_topics').select('id, visible_to_students, parent_id').eq('id', cur.parent_id).single()
      cur = parent
    }
    roadmapGroupId = roadmap.group_id
  }

  // Учитель назначает только свои тесты и только своим группам/ученикам
  // (RLS with check подстрахует на уровне БД, но отдаём внятную ошибку до инсерта)
  if (profile.role !== 'admin') {
    if (test.created_by !== user.id) {
      return NextResponse.json({ error: 'Назначать можно только свои тесты' }, { status: 403 })
    }
    if (target_type === 'group' && group_id) {
      const { data: group } = await admin
        .from('groups').select('id, created_by, organization_id').eq('id', group_id).single()
      if (!group || group.organization_id !== profile.organization_id || group.created_by !== user.id) {
        return NextResponse.json({ error: 'Назначать можно только своим группам' }, { status: 403 })
      }
    }
    if (target_type === 'student' && student_id) {
      // «Свой ученик» = прикреплён через M:N teacher_students (миграция 019),
      // а не по одиночному profiles.created_by — иначе второй учитель ученика
      // не мог назначать ему тесты
      const { data: link } = await admin
        .from('teacher_students').select('student_id')
        .eq('teacher_id', user.id).eq('student_id', student_id).maybeSingle()
      if (!link) {
        return NextResponse.json({ error: 'Назначать можно только своим ученикам' }, { status: 403 })
      }
    }
  } else {
    // admin: цель назначения должна быть из его организации
    if (target_type === 'group' && group_id) {
      const { data: group } = await admin
        .from('groups').select('id, organization_id').eq('id', group_id).single()
      if (!group || group.organization_id !== profile.organization_id) {
        return NextResponse.json({ error: 'Группа не найдена' }, { status: 404 })
      }
    }
    if (target_type === 'student' && student_id) {
      const { data: student } = await admin
        .from('profiles').select('id, role, organization_id').eq('id', student_id).single()
      if (!student || student.role !== 'student' || student.organization_id !== profile.organization_id) {
        return NextResponse.json({ error: 'Ученик не найден' }, { status: 404 })
      }
    }
  }

  const { data: assignment, error } = await admin.from('assignments').insert({
    test_version_id: test.current_published_version_id,
    organization_id: profile.organization_id,
    group_id: target_type === 'roadmap_topic' ? roadmapGroupId : target_type === 'group' ? group_id : null,
    student_id: target_type === 'student' ? student_id : null,
    roadmap_topic_id: target_type === 'roadmap_topic' ? roadmap_topic_id : null,
    starts_at: starts_at || null,
    ends_at: ends_at || null,
    max_attempts,
    preserve_answers,
    created_by: user.id,
  }).select('id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // телеграм-уведомление ученикам цели — после ответа, не задерживая запрос
  after(() => notifyAssignmentCreated(assignment.id))

  return NextResponse.json({ id: assignment.id }, { status: 201 })
}
