export default function AnalyticsSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 animate-fade">
      
      {/* Title */}
      <div className="skeleton h-6 w-40 mb-8"></div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-10">
        <div className="skeleton h-20 w-full"></div>
        <div className="skeleton h-20 w-full"></div>
        <div className="skeleton h-20 w-full"></div>
        <div className="skeleton h-20 w-full"></div>
      </div>

      {/* Most Common Label */}
      <div className="skeleton h-10 w-2/3 mb-10"></div>

      {/* Placeholder chart */}
      <div className="skeleton w-full h-64 rounded-md"></div>

    </div>
  );
}