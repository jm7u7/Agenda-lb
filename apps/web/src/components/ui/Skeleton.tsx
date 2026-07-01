import { cn } from '../../utils/cn';

interface SkeletonProps { className?: string; count?: number }

export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn('skeleton', className)} />;
}

export function AgendaSkeleton() {
  return (
    <div className="flex gap-px flex-1 overflow-hidden">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex-1 min-w-[140px]">
          <div className="h-14 skeleton mx-1 mb-px rounded" />
          {Array.from({ length: 12 }).map((_, j) => (
            <div key={j} className="h-10 mx-1 mb-px">
              {j % 3 === 0 && <div className="h-9 skeleton rounded" />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
