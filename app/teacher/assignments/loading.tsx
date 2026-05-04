import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="rounded-md border overflow-hidden">
        <div className="bg-muted/50 px-4 py-3 grid grid-cols-6 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-4 w-full" />)}
        </div>
        {[1, 2, 3, 5].map((i) => (
          <div key={i} className="px-4 py-3 grid grid-cols-6 gap-4 border-t">
            {[1, 2, 3, 4, 5, 6].map((j) => <Skeleton key={j} className="h-4 w-full" />)}
          </div>
        ))}
      </div>
    </div>
  )
}
