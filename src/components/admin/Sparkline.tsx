'use client';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

/**
 * Tiny inline SVG sparkline component.
 * Takes array of numbers, normalizes to fit height, renders a polyline.
 */
export function Sparkline({
  data,
  width = 64,
  height = 20,
  color = '#22C55E',
  className = '',
}: SparklineProps) {
  if (!data || data.length === 0) {
    return null;
  }

  // Find min and max to normalize data
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // Calculate points for polyline
  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1 || 1)) * width;
      // Invert y because SVG coordinates are top-down
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`inline-block ${className}`}
      aria-hidden="true"
      role="img"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
