export default function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
      
      {/* Camera Card Skeleton */}
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm"
        >
          <div className="skeleton h-6 w-32 mb-4"></div>

          <div className="skeleton h-64 w-full rounded-md"></div>

          <div className="mt-4 flex justify-between">
            <div className="skeleton h-5 w-24"></div>
            <div className="skeleton h-5 w-10"></div>
          </div>
        </div>
      ))}

    </div>
  );
}