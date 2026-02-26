export default function Loading() {
  return (
    <div className="p-10 text-gray-700 text-center">
      <div className="h-10 w-10 border-4 border-gray-300 border-t-gray-900 mx-auto rounded-full animate-spin"></div>
      <p className="mt-3 text-sm">Loading history...</p>
    </div>
  );
}