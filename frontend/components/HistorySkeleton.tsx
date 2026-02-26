export default function HistorySkeleton() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden animate-fade">
      
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="skeleton h-5 w-40"></div>
        <div className="skeleton h-5 w-16"></div>
      </div>

      {/* Table Skeleton */}
      <div className="p-6 space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between border-b border-gray-100 pb-4"
          >
            <div className="skeleton h-4 w-24"></div>
            <div className="skeleton h-4 w-32"></div>
            <div className="skeleton h-4 w-16"></div>
          </div>
        ))}
      </div>
    </div>
  );
}