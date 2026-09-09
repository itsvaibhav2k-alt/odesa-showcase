import { Skeleton } from '@/components/ui/skeleton';

export function CardSkeleton() {
  return (
    <div data-testid="loading-skeleton" className="rounded-xl border p-4 space-y-3">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

export function TableRowSkeleton() {
  return (
    <div
      data-testid="loading-skeleton"
      className="flex items-center gap-4 border-b py-3 px-4"
    >
      <Skeleton className="h-4 w-1/4" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-4 w-1/6" />
      <Skeleton className="h-4 w-1/6" />
    </div>
  );
}

export function StatSkeleton() {
  return (
    <div data-testid="loading-skeleton" className="rounded-xl border p-4 space-y-2">
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-8 w-1/3" />
    </div>
  );
}
