import { Skeleton } from '@/components/ui/skeleton';

export default function DocumentsLoading() {
  return (
    <div
      data-testid="documents-loading"
      className="today-theme"
      style={{
        minHeight: 'calc(100dvh - 56px)',
        background: 'var(--panel-clean)',
        padding: '32px max(36px, calc((100vw - 928px) / 2))',
      }}
    >
      <Skeleton className="h-3 w-24" />
      <div className="mt-6 flex items-center justify-between gap-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-9 w-24 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-3 w-72" />
      <div className="mt-8 flex gap-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-24 rounded-full" />
        ))}
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-[var(--hairline)]">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="flex items-center gap-5 border-b p-5 last:border-b-0"
          >
            <Skeleton className="h-9 w-9 rounded-lg" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
