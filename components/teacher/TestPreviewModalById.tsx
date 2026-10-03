'use client'

import { useEffect, useState } from 'react'
import { TestPreviewModal } from '@/components/teacher/TestPreviewModal'
import type { TestTask } from '@/components/teacher/TestDetailClient'

interface Props {
  testId: string | null
  onClose: () => void
}

// Обёртка над TestPreviewModal для мест без уже загруженных tasks (список
// программы и т.п.) — сама тянет состав теста по testId через
// /api/tests/[id]/preview.
export function TestPreviewModalById({ testId, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ title: string; tasks: TestTask[] } | null>(null)

  useEffect(() => {
    if (!testId) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/tests/${testId}/preview`)
      .then((res) => res.json())
      .then((json) => { if (!cancelled) setData(json) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [testId])

  return (
    <TestPreviewModal
      open={!!testId}
      onClose={onClose}
      testTitle={loading ? 'Загрузка…' : (data?.title ?? '')}
      tasks={data?.tasks ?? []}
    />
  )
}
