/* Inline SVG sparkline for the last 7 days of activity. Smooth spline
   with area fill, faint grid lines, day labels. Pure component. */
const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return pts.length ? `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}` : "";
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

export function PaceSparkline({ points }: { points: number[] }) {
  if (points.length === 0) {
    return null;
  }
  // viewBox aspect matches its column so a uniform scale fills the width
  // instead of letterboxing, and the day labels stay legible at ~272px.
  const width = 300;
  const height = 112;
  const padding = 4;
  const labelH = 12;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2 - labelH;
  const max = Math.max(1, ...points);
  const stepX = innerW / Math.max(1, points.length - 1);
  const pts = points.map((p, i) => ({
    x: padding + i * stepX,
    y: padding + innerH - (p / max) * innerH,
  }));
  const line = smoothPath(pts);
  const base = padding + innerH;
  const area = `${line} L ${pts[pts.length - 1].x.toFixed(2)} ${base.toFixed(2)} L ${pts[0].x.toFixed(2)} ${base.toFixed(2)} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg
      className="home-sparkline"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Words spoken over the last 7 days"
    >
      <defs>
        <linearGradient id="paceArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => {
        const y = padding + innerH * f;
        return <line key={f} x1={padding} x2={width - padding} y1={y} y2={y} className="pace-grid" />;
      })}
      <path d={area} fill="url(#paceArea)" stroke="none" />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last.x} cy={last.y} r={3} fill="currentColor" className="pace-dot" />
      {pts.map((p, i) =>
        DAY_LABELS[i] ? (
          <text key={i} x={p.x} y={height - 1} textAnchor="middle" className="pace-day">
            {DAY_LABELS[i]}
          </text>
        ) : null
      )}
    </svg>
  );
}
