import { SkeletonCard } from '@/components/Skeleton'

export default function PropertiesLoading() {
  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="animate-pulse bg-slate-200 h-7 w-48 rounded-xl" />
          <div className="animate-pulse bg-slate-200 h-4 w-32 rounded-xl" />
        </div>
        <div className="animate-pulse bg-slate-200 h-10 w-32 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white rounded-[2.5rem] border border-slate-100 overflow-hidden">
            <div className="animate-pulse bg-slate-200 h-48 w-full" />
            <div className="p-6 space-y-3">
              <SkeletonCard />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
