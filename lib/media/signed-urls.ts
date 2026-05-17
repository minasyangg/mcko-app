import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { TaskMedia, TaskMediaWithUrl } from '@/types/domain'

const SIGNED_URL_TTL = 14400 // 4 hours — covers most exam sessions

type Bucket = 'task-media' | 'solution-media' | 'test-documents'

export async function generateSignedUrls(
  supabase: SupabaseClient<Database>,
  items: Array<{ storage_path: string; bucket: Bucket }>
): Promise<Record<string, string>> {
  if (items.length === 0) return {}

  // Group by bucket
  const byBucket = new Map<Bucket, string[]>()
  for (const { bucket, storage_path } of items) {
    if (!byBucket.has(bucket)) byBucket.set(bucket, [])
    byBucket.get(bucket)!.push(storage_path)
  }

  const result: Record<string, string> = {}

  for (const [bucket, paths] of byBucket) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrls(paths, SIGNED_URL_TTL)

    if (error || !data) {
      console.error(`[signed-urls] createSignedUrls failed for bucket "${bucket}":`, error?.message ?? 'no data')
      continue
    }

    for (const item of data) {
      if (item.signedUrl && item.path) {
        result[item.path] = item.signedUrl
      } else if (item.path) {
        console.error(`[signed-urls] Empty signedUrl for path: ${item.path}`)
      }
    }
  }

  return result
}

export async function enrichTaskMediaWithUrls(
  supabase: SupabaseClient<Database>,
  mediaItems: TaskMedia[]
): Promise<TaskMediaWithUrl[]> {
  if (mediaItems.length === 0) return []

  const urlMap = await generateSignedUrls(
    supabase,
    mediaItems.map((m) => ({ storage_path: m.storage_path, bucket: 'task-media' }))
  )

  return mediaItems.map((m) => ({
    ...m,
    signedUrl: urlMap[m.storage_path] ?? '',
  }))
}
