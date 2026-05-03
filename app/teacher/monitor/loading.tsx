import { Skeleton } from '@/components/ui/skeleton'

export default function MonitorLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="rounded-md border overflow-hidden">
        <div className="bg-muted/50 px-4 py-3 flex gap-4">
          {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-4 w-20" />)}
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="border-t px-4 py-3 flex gap-4">
            {Array.from({ length: 7 }).map((_, j) => <Skeleton key={j} className="h-4 w-20" />)}
          </div>
        ))}
      </div>
    </div>
  )
}
