import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { TaskMedia, TaskMediaWithUrl } from '@/types/domain'

// task-media bucket is PUBLIC — URLs never expire, no signing needed.
// Other buckets (solution-media, test-documents) remain private with signed URLs.
const SIGNED_URL_TTL = 14400 // 4 hours, used for private buckets only

type Bucket = 'task-media' | 'solution-media' | 'test-documents'

export async function generateSignedUrls(
  supabase: SupabaseClient<Database>,
  items: Array<{ storage_path: string; bucket: Bucket }>
): Promise<Record<string, string>> {
  if (items.length === 0) return {}

  const result: Record<string, string> = {}

  // Public bucket: construct URL directly (no API call, no expiry)
  for (const { bucket, storage_path } of items) {
    if (bucket === 'task-media') {
      const { data } = supabase.storage.from('task-media').getPublicUrl(storage_path)
      result[storage_path] = data.publicUrl
    }
  }

  // Private buckets: generate signed URLs
  const privateItems = items.filter(({ bucket }) => bucket !== 'task-media')
  if (privateItems.length === 0) return result

  const byBucket = new Map<Bucket, string[]>()
  for (const { bucket, storage_path } of privateItems) {
    if (!byBucket.has(bucket)) byBucket.set(bucket, [])
    byBucket.get(bucket)!.push(storage_path)
  }

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

// task-media is public — returns permanent public URLs synchronously.
// No API calls, no expiry, works on server and client.
export function enrichTaskMediaWithUrls(
  supabase: SupabaseClient<Database>,
  mediaItems: TaskMedia[]
): Promise<TaskMediaWithUrl[]> {
  if (mediaItems.length === 0) return Promise.resolve([])

  const enriched = mediaItems.map((m) => {
    const { data } = supabase.storage.from('task-media').getPublicUrl(m.storage_path)
    return { ...m, signedUrl: data.publicUrl }
  })

  return Promise.resolve(enriched)
}
