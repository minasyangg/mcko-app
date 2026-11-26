import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

// Файлы работы бланка ответов по PDF (tests.answer_sheet, миграция 116) —
// test_documents с doc_type='variant' в приватном бакете test-documents.
// Ученику прямого доступа к бакету нет: ссылки подписывает сервер
// service-role клиентом ПОСЛЕ того, как вызывающая страница проверила доступ
// к назначению (тот же приём, что у solution-media на странице результата).

export interface SheetMaterial {
  id: string
  name: string
  url: string
}

// Ссылка живёт дольше обычной: работу пишут часами, а PDF открывают заново
// посреди решения
const MATERIAL_URL_TTL = 6 * 3600

export async function loadSheetMaterials(admin: AdminClient, testVersionId: string): Promise<SheetMaterial[]> {
  const { data: docs } = await admin
    .from('test_documents')
    .select('id, original_filename, storage_path')
    .eq('test_version_id', testVersionId)
    .eq('doc_type', 'variant')
    .order('created_at', { ascending: true })
    .limit(10)
  if (!docs?.length) return []

  const { data: signed } = await admin.storage
    .from('test-documents')
    .createSignedUrls(docs.map(d => d.storage_path), MATERIAL_URL_TTL)
  const urlByPath = new Map((signed ?? []).map(s => [s.path, s.signedUrl]))

  return docs
    .map((d, i) => ({
      id: d.id,
      name: d.original_filename || `Файл ${i + 1}`,
      url: urlByPath.get(d.storage_path) ?? '',
    }))
    .filter(m => m.url)
}
