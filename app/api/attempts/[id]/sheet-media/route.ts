import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { MEDIA_CACHE_CONTROL, SOLUTION_PHOTO_URL_TTL } from '@/lib/media/signed-urls'
import { prepareSolutionPhoto, STUDENT_SOLUTION_BUCKET } from '@/lib/media/solution-photo'
import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { SHEET_MAX_PHOTOS } from '@/lib/assignments/offline'

// См. tasks/[taskId]/solution-media: сжатие фото с телефона занимает секунды
export const maxDuration = 60

const BUCKET = STUDENT_SOLUTION_BUCKET

// Фото решения на ВСЮ работу бланка ответов по PDF (tests.answer_sheet,
// миграция 116): ученик решает на бумаге и прикладывает до SHEET_MAX_PHOTOS
// листов к попытке, а не к отдельному заданию (attempt_answer_media.task_id =
// null). Контракт владения и статуса — как у фото к заданию.

type Supabase = Awaited<ReturnType<typeof createClient>>

async function checkAttempt(supabase: Supabase, attemptId: string, userId: string) {
  const { data: attempt } = await supabase
    .from('attempts')
    .select('id, student_id, status, assignments!inner(test_versions!test_version_id(tests!test_id(answer_sheet)))')
    .eq('id', attemptId)
    .single()
  if (!attempt) return Response.json({ error: 'Attempt not found' }, { status: 404 })
  if (attempt.student_id !== userId) return Response.json({ error: 'Forbidden' }, { status: 403 })
  if (attempt.status !== 'in_progress') {
    return Response.json({ error: 'Attempt is not in progress' }, { status: 409 })
  }
  const isSheet = (attempt.assignments as { test_versions?: { tests?: { answer_sheet?: boolean } } } | null)
    ?.test_versions?.tests?.answer_sheet
  if (!isSheet) return Response.json({ error: 'Фото на всю работу — только для бланка ответов' }, { status: 400 })
  return null
}

// POST /api/attempts/[id]/sheet-media — Body: FormData { file: File }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: attemptId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await getAuthUser(supabase)
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const denied = await checkAttempt(supabase, attemptId, user.id)
  if (denied) return denied

  const admin = createAdminClient()
  const { data: existingSlots } = await admin
    .from('attempt_answer_media')
    .select('sort_order')
    .eq('attempt_id', attemptId).is('task_id', null)
  const taken = new Set((existingSlots ?? []).map(s => s.sort_order))
  const slot = [...Array(SHEET_MAX_PHOTOS).keys()].find(i => !taken.has(i))
  if (slot === undefined) {
    return Response.json({ error: `Не больше ${SHEET_MAX_PHOTOS} фото на работу` }, { status: 422 })
  }

  const formData = await request.formData()
  const photo = await prepareSolutionPhoto(formData.get('file') as File | null)
  if (!photo.ok) return Response.json({ error: photo.error }, { status: photo.status })

  const storagePath = `${attemptId}/sheet/${slot}-${Date.now()}.webp`
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, photo.buffer, {
      contentType: 'image/webp',
      upsert: false,
      cacheControl: MEDIA_CACHE_CONTROL,
    })
  if (uploadError) return Response.json({ error: uploadError.message }, { status: 500 })

  const { data: mediaRecord, error: mediaError } = await admin
    .from('attempt_answer_media')
    .insert({
      attempt_id: attemptId,
      task_id: null,
      storage_path: storagePath,
      format: 'webp',
      width_px: photo.width,
      height_px: photo.height,
      file_size_bytes: photo.buffer.length,
      sort_order: slot,
    })
    .select('id, sort_order')
    .single()

  if (mediaError || !mediaRecord) {
    await admin.storage.from(BUCKET).remove([storagePath])
    // Гонка на тот же слот (attempt_answer_media_sheet_slot_idx)
    const isSlotRace = mediaError?.code === '23505'
    return Response.json(
      { error: isSlotRace ? 'Слот уже занят, обновите страницу' : 'Failed to create media record' },
      { status: isSlotRace ? 409 : 500 }
    )
  }

  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(storagePath, SOLUTION_PHOTO_URL_TTL)

  await supabase.from('attempts').update({ last_activity_at: new Date().toISOString() }).eq('id', attemptId)

  return Response.json({
    id: mediaRecord.id,
    sort_order: mediaRecord.sort_order,
    signedUrl: signed?.signedUrl ?? null,
  })
}

// DELETE /api/attempts/[id]/sheet-media?media_id=<uuid>
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: attemptId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await getAuthUser(supabase)
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const mediaId = request.nextUrl.searchParams.get('media_id')
  if (!mediaId) return Response.json({ error: 'media_id required' }, { status: 400 })

  const denied = await checkAttempt(supabase, attemptId, user.id)
  if (denied) return denied

  const admin = createAdminClient()
  const { data: media } = await admin
    .from('attempt_answer_media')
    .select('id, storage_path')
    .eq('id', mediaId).eq('attempt_id', attemptId).is('task_id', null)
    .single()
  if (!media) return Response.json({ error: 'Media not found' }, { status: 404 })

  const { error: deleteRowError } = await admin.from('attempt_answer_media').delete().eq('id', mediaId)
  if (deleteRowError) return Response.json({ error: deleteRowError.message }, { status: 500 })

  await admin.storage.from(BUCKET).remove([media.storage_path])

  return Response.json({ ok: true })
}
