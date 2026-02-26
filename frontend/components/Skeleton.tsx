export default function Skeleton({ height = '20px', width = '100%' }) {
  return (
    <div
      className="skeleton"
      style={{ height, width }}
    ></div>
  );
}