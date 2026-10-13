import { NextRequest } from 'next/server'
import { requireTheoryStaff } from '@/lib/theory/access'

// POST /api/theory/media — загрузить картинку для теории (multipart, поле
// file). Ответ: { url } — публичная ссылка для вставки в markdown. Бакет
// theory-media (миграция 100), путь {organization_id}/{uuid}.{ext}.
const TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
const MAX_BYTES = 4 * 1024 * 1024

export async function POST(request: NextRequest) {
  const staff = await requireTheoryStaff()
  if ('error' in staff) return staff.error

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'Файл не передан' }, { status: 400 })
  const ext = TYPES[file.type]
  if (!ext) return Response.json({ error: 'Поддерживаются PNG, JPEG, WebP и GIF' }, { status: 400 })
  if (file.size > MAX_BYTES) return Response.json({ error: 'Картинка больше 4 МБ' }, { status: 400 })

  const path = `${staff.orgId}/${crypto.randomUUID()}.${ext}`
  const { error } = await staff.admin.storage
    .from('theory-media')
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const { data } = staff.admin.storage.from('theory-media').getPublicUrl(path)
  return Response.json({ url: data.publicUrl }, { status: 201 })
}
