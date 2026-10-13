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

// Тип из заголовка запроса задаёт клиент — сверяем с сигнатурой файла,
// чтобы в публичный бакет под видом картинки не попал HTML или скрипт
function signatureMatches(type: string, b: Uint8Array): boolean {
  const at = (offset: number, bytes: number[]) => bytes.every((v, i) => b[offset + i] === v)
  switch (type) {
    case 'image/png': return at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/jpeg': return at(0, [0xff, 0xd8, 0xff])
    case 'image/gif': return at(0, [0x47, 0x49, 0x46, 0x38]) // GIF8
    case 'image/webp': return at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50]) // RIFF….WEBP
    default: return false
  }
}

export async function POST(request: NextRequest) {
  const staff = await requireTheoryStaff()
  if ('error' in staff) return staff.error

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'Файл не передан' }, { status: 400 })
  const ext = TYPES[file.type]
  if (!ext) return Response.json({ error: 'Поддерживаются PNG, JPEG, WebP и GIF' }, { status: 400 })
  if (file.size > MAX_BYTES) return Response.json({ error: 'Картинка больше 4 МБ' }, { status: 400 })

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!signatureMatches(file.type, bytes)) {
    return Response.json({ error: 'Файл не похож на картинку PNG, JPEG, WebP или GIF' }, { status: 400 })
  }

  const path = `${staff.orgId}/${crypto.randomUUID()}.${ext}`
  const { error } = await staff.admin.storage
    .from('theory-media')
    .upload(path, Buffer.from(bytes), { contentType: file.type, upsert: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const { data } = staff.admin.storage.from('theory-media').getPublicUrl(path)
  return Response.json({ url: data.publicUrl }, { status: 201 })
}
