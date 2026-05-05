import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

interface DeleteStudentParams {
  params: Promise<{ id: string }>
}

/**
 * DELETE /api/admin/students/[id]
 * Soft-delete a student and cascade related data
 * Preserves final test results for analytics
 */
export async function DELETE(
  request: Request,
  { params }: DeleteStudentParams
) {
  const { id } = await params

  // Verify auth
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify user is teacher/admin
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

  // Verify student exists and belongs to same organization
  const admin = createAdminClient()
  const { data: student } = await admin
    .from('profiles')
    .select('id, organization_id, role')
    .eq('id', id)
    .single()

  if (!student || student.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: 'Student not found' }, { status: 404 })
  }

  if (student.role !== 'student') {
    return NextResponse.json({ error: 'Not a student' }, { status: 400 })
  }

  try {
    // Call the cascade deletion function
    const { data, error } = await (admin as any).rpc('delete_student_cascade', {
      target_student_id: id,
    })

    if (error) {
      console.error('delete_student_cascade error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (data?.error) {
      return NextResponse.json({ error: (data as any).error }, { status: 400 })
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Student deleted successfully',
        data,
      },
      { status: 200 }
    )
  } catch (err) {
    console.error('Unexpected error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
