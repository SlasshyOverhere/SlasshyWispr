/* Inline SVG sparkline for the last 7 days of activity. Pads missing
   days with zeros so the line still traces a path. Pure component —
   no DOM manipulation, no library. */
export function PaceSparkline({ points }: { points: number[] }) {
  if (points.length === 0) {
    return null;
  }
  const width = 240;
  const height = 56;
  const padding = 4;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const max = Math.max(1, ...points);
  const stepX = innerW / Math.max(1, points.length - 1);
  const path = points
    .map((p, i) => {
      const x = padding + i * stepX;
      const y = padding + innerH - (p / max) * innerH;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg
      className="home-sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Words spoken over the last 7 days"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((p, i) => {
        const x = padding + i * stepX;
        const y = padding + innerH - (p / Math.max(1, ...points)) * innerH;
        return (
          <circle
            key={`pt-${i}`}
            cx={x}
            cy={y}
            r={i === points.length - 1 ? 3 : 1.6}
            fill="currentColor"
          />
        );
      })}
    </svg>
  );
}
