import type { SupabaseClient } from '@supabase/supabase-js'

// Вложение-картинка задачи, которое уже стоит ссылкой в тексте условия, —
// дубль: плеер показал бы рисунок дважды (над условием и в нём). Такие
// вложения получают placement 'inline' — то же правило, что в миграции 103.
//
// Дубль узнаётся по имени файла вложения без расширения (≥ 8 символов) в
// ссылке library-media/… внутри prompt_html. У заданий ФИПИ имя в тексте
// длиннее имени вложения (…_087b03d9e86a3397.jpg против …_087b03d9e86a.jpg),
// поэтому «содержится», а не «равно». Короткие имена вида «img1» не
// сверяются — слишком легко совпасть случайно.

// Путь в бакете library-media картинки из текста условия, повторяющей
// вложение storagePath, или null, если такой ссылки в тексте нет
export function promptLibraryImagePath(storagePath: string, promptHtml: string | null | undefined): string | null {
  if (!promptHtml) return null
  const base = storagePath.split('/').pop()?.replace(/\.[a-z0-9]+$/i, '') ?? ''
  if (base.length < 8 || !promptHtml.includes(base)) return null
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = promptHtml.match(new RegExp(`library-media/([^\\s)"']*${escaped}[^\\s)"']*)`))
  return m ? m[1] : null
}

// Цела ли копия рисунка в тексте условия (null — не удалось проверить). В
// банке ФИПИ часть «картинок» — сохранённые страницы 404 (HTML ~278 байт):
// прятать вложение ради такой копии нельзя — пропал бы единственный рабочий
// рисунок. Проверяем содержимое, а не размер: настоящие графики ФИПИ тоже
// крошечные (700–850 байт PNG), порог по размеру их браковал.
async function libraryImageLooksReal(admin: SupabaseClient, path: string): Promise<boolean | null> {
  const { data, error } = await admin.storage.from('library-media').download(path)
  if (error || !data) return null
  const head = new Uint8Array(await data.slice(0, 64).arrayBuffer())
  if (head.length === 0) return false
  const text = String.fromCharCode(...head).trimStart().toLowerCase()
  return !(text.startsWith('<!doctype') || text.startsWith('<html'))
}

// placement вложения при копировании задачи из библиотеки в ДЗ: 'inline',
// если тот же рисунок есть в тексте условия и эта копия цела; иначе — как в
// библиотеке. При любой неясности (ошибка Storage) — как в библиотеке:
// лишний дубль лучше пропавшего рисунка.
export async function conditionMediaPlacement(
  admin: SupabaseClient,
  media: { storage_path: string; placement: string | null },
  promptHtml: string | null | undefined,
): Promise<string> {
  const placement = media.placement ?? 'above_text'
  if (placement !== 'above_text' && placement !== 'below_text') return placement
  const promptPath = promptLibraryImagePath(media.storage_path, promptHtml)
  if (!promptPath) return placement
  return (await libraryImageLooksReal(admin, promptPath)) === true ? 'inline' : placement
}
