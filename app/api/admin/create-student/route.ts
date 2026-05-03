import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  full_name: z.string().min(2, 'Минимум 2 символа'),
  email: z.string().email('Некорректный email'),
  grade: z.string().optional(),
  password: z.string().min(6, 'Минимум 6 символов'),
})

export async function POST(request: Request) {
  const supabase = await createClient()

  // Auth: only teacher/admin can create students
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  }

  const { full_name, email, grade, password } = parsed.data

  const adminClient = createAdminClient()

  // Create user with confirmed email via admin API
  const { data: authData, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role: 'student' },
  })

  if (createError) {
    if (createError.message.includes('already registered') || createError.message.includes('already been registered')) {
      return NextResponse.json({ error: 'Пользователь с таким email уже существует' }, { status: 409 })
    }
    return NextResponse.json({ error: createError.message }, { status: 500 })
  }

  // Update profile with organization_id and grade
  // (trigger handle_new_user already created the profile)
  const { error: updateError } = await adminClient
    .from('profiles')
    .update({
      organization_id: profile.organization_id,
      grade: grade || null,
      full_name,
      role: 'student',
    })
    .eq('id', authData.user.id)

  if (updateError) {
    console.error('Failed to update profile:', updateError)
  }

  return NextResponse.json({ id: authData.user.id, email }, { status: 201 })
}
