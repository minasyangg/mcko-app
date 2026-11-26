// Подготовка фото письменного решения ученика (лист с почерком, снятый
// телефоном) к хранению в student-solution-media: проверка файла и сжатие в
// webp. Общая для фото к заданию (tasks/[taskId]/solution-media) и фото на
// всю работу бланка ответов (sheet-media, миграция 116).

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp')

export const STUDENT_SOLUTION_BUCKET = 'student-solution-media'

// Мобильные фото из галереи часто 5-15MB — принимаем крупнее лимита
// бакета (5MB, это лимит УЖЕ СЖАТОГО webp), sharp сожмёт перед заливкой.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

export type PreparedPhoto =
  | { ok: true; buffer: Buffer; width: number | null; height: number | null }
  | { ok: false; error: string; status: number }

export async function prepareSolutionPhoto(file: File | null): Promise<PreparedPhoto> {
  if (!file) return { ok: false, error: 'No file provided', status: 400 }
  if (!file.type.startsWith('image/')) return { ok: false, error: 'File must be an image', status: 400 }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: 'Файл слишком большой (максимум 20 МБ)', status: 400 }
  }

  const rawBuffer = Buffer.from(await file.arrayBuffer())
  try {
    const meta = await sharp(rawBuffer).metadata()
    const buffer: Buffer = await sharp(rawBuffer)
      // Фото листа А4 с телефона — ширины 1600px достаточно для читаемости
      // почерка, тот же порог, что уже используют task-media (media/route.ts)
      .resize({ width: 1600, withoutEnlargement: true })
      .rotate() // учитывает EXIF-ориентацию камеры телефона
      .webp({ quality: 82 })
      .toBuffer()
    return { ok: true, buffer, width: meta.width ?? null, height: meta.height ?? null }
  } catch {
    return { ok: false, error: 'Не удалось обработать изображение', status: 422 }
  }
}
