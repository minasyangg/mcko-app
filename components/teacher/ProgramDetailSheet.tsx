'use client'

import { useEffect, useState, useCallback } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { AttemptDrawer } from '@/components/teacher/AttemptDrawer'
import { ProgramProgressView } from '@/components/teacher/ProgramProgressView'
import type { ProgramDetail } from '@/lib/roadmaps/progress'

interface Props {
  roadmapId: string | null
  onClose: () => void
}

// Открывается по клику на сводную строку программы (см. ProgramSummaryTable).
// Данные — по требованию (не грузятся заранее для всех программ), поэтому
// после оценки попытки в AttemptDrawer здесь достаточно локального рефетча,
// без перезагрузки всей страницы мониторинга.
export function ProgramDetailSheet({ roadmapId, onClose }: Props) {
  const [detail, setDetail] = useState<ProgramDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null)

  const load = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/roadmaps/${id}/progress`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'Ошибка загрузки'); return }
      setDetail(data as ProgramDetail)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!roadmapId) { setDetail(null); return }
    load(roadmapId)
  }, [roadmapId, load])

  return (
    <>
      <Sheet open={!!roadmapId} onOpenChange={(v) => { if (!v) onClose() }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="pb-4 border-b">
            <SheetTitle>{detail?.title ?? 'Программа'}</SheetTitle>
            {detail?.subject && <p className="text-sm text-muted-foreground">{detail.subject}</p>}
          </SheetHeader>

          <div className="p-4">
            {loading && (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            )}
            {!loading && error && <p className="text-sm text-destructive">{error}</p>}
            {!loading && !error && detail && (
              <ProgramProgressView
                program={detail}
                onSelectAttempt={setSelectedAttemptId}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AttemptDrawer
        attemptId={selectedAttemptId}
        onClose={() => setSelectedAttemptId(null)}
        onGraded={() => {
          setSelectedAttemptId(null)
          if (roadmapId) load(roadmapId) // локальный рефетч, без reload страницы
        }}
      />
    </>
  )
}
