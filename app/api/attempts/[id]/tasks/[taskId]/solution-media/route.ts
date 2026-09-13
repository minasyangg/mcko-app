import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp')

const BUCKET = 'student-solution-media'
const MAX_PHOTOS_PER_TASK = 2

// POST /api/attempts/[id]/tasks/[taskId]/solution-media
// Body: FormData { file: File } — фото письменного решения (черновик на
// бумаге), которое ученик прикрепляет к заданию прямо в симуляторе теста.
// Не более MAX_PHOTOS_PER_TASK на (attempt, task) — занимает первый
// свободный слот sort_order (0 или 1).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const { id: attemptId, taskId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Владение и статус попытки — тот же контракт, что и у сохранения
  // текстового ответа (app/api/attempts/[id]/answers/route.ts).
  const { data: attempt } = await supabase
    .from('attempts').select('id, student_id, status').eq('id', attemptId).single()
  if (!attempt) return Response.json({ error: 'Attempt not found' }, { status: 404 })
  if (attempt.student_id !== user.id) return Response.json({ error: 'Forbidden' }, { status: 403 })
  if (attempt.status !== 'in_progress') {
    return Response.json({ error: 'Attempt is not in progress' }, { status: 409 })
  }

  // Задание должно принадлежать той же версии теста, на которую назначена
  // ИМЕННО эта попытка — без этого ученик мог бы подсунуть taskId чужого
  // теста и залить фото туда, куда доступа быть не должно.
  const { data: attemptAssignment } = await supabase
    .from('attempts')
    .select('assignments!inner(test_version_id)')
    .eq('id', attemptId)
    .single()
  const versionId = (attemptAssignment?.assignments as { test_version_id: string } | null)?.test_version_id
  const { data: task } = await supabase
    .from('test_tasks').select('id').eq('id', taskId).eq('test_version_id', versionId ?? '').single()
  if (!task) return Response.json({ error: 'Task not found' }, { status: 404 })

  // Уже зафиксированный (is_locked) ответ прошлой попыткой — фото решения
  // менять/добавлять тоже нельзя, тот же принцип, что и с текстом.
  const { data: existingAnswer } = await supabase
    .from('attempt_task_answers')
    .select('is_locked')
    .eq('attempt_id', attemptId).eq('task_id', taskId).single()
  if (existingAnswer?.is_locked) {
    return Response.json({ error: 'Ответ зафиксирован, изменить нельзя' }, { status: 409 })
  }

  const { count } = await supabase
    .from('attempt_answer_media')
    .select('*', { count: 'exact', head: true })
    .eq('attempt_id', attemptId).eq('task_id', taskId)
  const usedSlots = count ?? 0
  if (usedSlots >= MAX_PHOTOS_PER_TASK) {
    return Response.json({ error: `Не больше ${MAX_PHOTOS_PER_TASK} фото на задание` }, { status: 422 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })
  if (!file.type.startsWith('image/')) {
    return Response.json({ error: 'File must be an image' }, { status: 400 })
  }
  // Мобильные фото из галереи часто 5-15MB — принимаем крупнее лимита
  // бакета (5MB, это лимит УЖЕ СЖАТОГО webp), sharp сожмёт перед заливкой.
  if (file.size > 20 * 1024 * 1024) {
    return Response.json({ error: 'Файл слишком большой (максимум 20 МБ)' }, { status: 400 })
  }

  const rawBuffer = Buffer.from(await file.arrayBuffer())

  let webpBuffer: Buffer
  let width: number | null = null
  let height: number | null = null
  try {
    const meta = await sharp(rawBuffer).metadata()
    width = meta.width ?? null
    height = meta.height ?? null
    webpBuffer = await sharp(rawBuffer)
      // Фото листа А4 с телефона — ширины 1600px достаточно для читаемости
      // почерка, тот же порог, что уже используют task-media (media/route.ts)
      .resize({ width: 1600, withoutEnlargement: true })
      .rotate() // учитывает EXIF-ориентацию камеры телефона
      .webp({ quality: 82 })
      .toBuffer()
  } catch {
    return Response.json({ error: 'Не удалось обработать изображение' }, { status: 422 })
  }

  const admin = createAdminClient()
  // Свободный слот — 0, если ничего ещё нет, иначе первый неиспользованный
  // (usedSlots может быть 1 при удалённом слоте 0, поэтому явная проверка,
  // а не просто usedSlots как индекс).
  const { data: existingSlots } = await admin
    .from('attempt_answer_media')
    .select('sort_order')
    .eq('attempt_id', attemptId).eq('task_id', taskId)
  const taken = new Set((existingSlots ?? []).map(s => s.sort_order))
  const slot = taken.has(0) ? 1 : 0

  const storagePath = `${attemptId}/${taskId}/${slot}-${Date.now()}.webp`
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, webpBuffer, { contentType: 'image/webp', upsert: false })
  if (uploadError) return Response.json({ error: uploadError.message }, { status: 500 })

  const { data: mediaRecord, error: mediaError } = await admin
    .from('attempt_answer_media')
    .insert({
      attempt_id: attemptId,
      task_id: taskId,
      storage_path: storagePath,
      format: 'webp',
      width_px: width,
      height_px: height,
      file_size_bytes: webpBuffer.length,
      sort_order: slot,
    })
    .select('id, sort_order')
    .single()

  if (mediaError || !mediaRecord) {
    await admin.storage.from(BUCKET).remove([storagePath])
    // Гонка на тот же слот (уникальный индекс attempt_answer_media_slot_idx) —
    // сообщаем как «занято», не как общую ошибку сервера.
    const isSlotRace = mediaError?.code === '23505'
    return Response.json(
      { error: isSlotRace ? 'Слот уже занят, обновите страницу' : 'Failed to create media record' },
      { status: isSlotRace ? 409 : 500 }
    )
  }

  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(storagePath, 3600)

  await supabase.from('attempts').update({ last_activity_at: new Date().toISOString() }).eq('id', attemptId)

  return Response.json({
    id: mediaRecord.id,
    sort_order: mediaRecord.sort_order,
    signedUrl: signed?.signedUrl ?? null,
    width_px: width,
    height_px: height,
  })
}

// DELETE /api/attempts/[id]/tasks/[taskId]/solution-media?media_id=<uuid>
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const { id: attemptId, taskId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const mediaId = request.nextUrl.searchParams.get('media_id')
  if (!mediaId) return Response.json({ error: 'media_id required' }, { status: 400 })

  const { data: attempt } = await supabase
    .from('attempts').select('id, student_id, status').eq('id', attemptId).single()
  if (!attempt) return Response.json({ error: 'Attempt not found' }, { status: 404 })
  if (attempt.student_id !== user.id) return Response.json({ error: 'Forbidden' }, { status: 403 })
  if (attempt.status !== 'in_progress') {
    return Response.json({ error: 'Attempt is not in progress' }, { status: 409 })
  }

  const { data: existingAnswer } = await supabase
    .from('attempt_task_answers')
    .select('is_locked')
    .eq('attempt_id', attemptId).eq('task_id', taskId).single()
  if (existingAnswer?.is_locked) {
    return Response.json({ error: 'Ответ зафиксирован, изменить нельзя' }, { status: 409 })
  }

  const admin = createAdminClient()
  const { data: media } = await admin
    .from('attempt_answer_media')
    .select('id, storage_path')
    .eq('id', mediaId).eq('attempt_id', attemptId).eq('task_id', taskId)
    .single()
  if (!media) return Response.json({ error: 'Media not found' }, { status: 404 })

  const { error: deleteRowError } = await admin.from('attempt_answer_media').delete().eq('id', mediaId)
  if (deleteRowError) return Response.json({ error: deleteRowError.message }, { status: 500 })

  await admin.storage.from(BUCKET).remove([media.storage_path])

  return Response.json({ ok: true })
}
