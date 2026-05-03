import { Skeleton } from '@/components/ui/skeleton'

export default function ResultsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="rounded-md border overflow-hidden">
        <div className="bg-muted/50 px-4 py-3 flex gap-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-4 w-16" />)}
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="border-t px-4 py-3 flex gap-4">
            {Array.from({ length: 8 }).map((_, j) => <Skeleton key={j} className="h-4 w-16" />)}
          </div>
        ))}
      </div>
    </div>
  )
}
