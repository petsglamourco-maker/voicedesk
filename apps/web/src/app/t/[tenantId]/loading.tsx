import { Skeleton } from "@voicedesk/ui";

/** Content-shaped placeholder while a screen loads: hero banner, then cards. */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="glass flex items-center gap-5 rounded-xl px-5 py-6 sm:px-7">
        <Skeleton className="size-14 shrink-0 rounded-2xl" />
        <div className="flex-1 space-y-2.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-full max-w-lg" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="glass space-y-3 rounded-xl p-5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
      <div className="glass space-y-3 rounded-xl p-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  );
}
