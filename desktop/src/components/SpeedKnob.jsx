import { useRef, useCallback } from 'react';

const SIZE = 80;
const STROKE = 6;
const R = 32; // arc radius
const CX = SIZE / 2;
const CY = SIZE / 2 + 6; // push arc down a bit so label fits on top

// Arc from 150° to 390° (240° sweep — wider gap at bottom)
const START = 150;
const END = 390;
const SWEEP = END - START;

const pol = (cx, cy, r, deg) => {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
};

const arc = (cx, cy, r, a1, a2) => {
  const s = pol(cx, cy, r, a1);
  const e = pol(cx, cy, r, a2);
  const big = a2 - a1 > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${big} 1 ${e.x} ${e.y}`;
};

export default function SpeedKnob({ value, onChange, min = 0.5, max = 1.5, step = 0.05 }) {
  const ref = useRef(null);
  const dragging = useRef(false);

  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const curAngle = START + frac * SWEEP;
  const thumb = pol(CX, CY, R, curAngle);

  const angleToVal = useCallback((angle) => {
    let a = angle;
    if (a < START) a += 360;
    let f = (a - START) / SWEEP;
    f = Math.max(0, Math.min(1, f));
    let v = min + f * (max - min);
    v = Math.round(v / step) * step;
    return Math.max(min, Math.min(max, parseFloat(v.toFixed(2))));
  }, [min, max, step]);

  const getAngle = useCallback((e) => {
    const rect = ref.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2 + 6;
    const px = e.touches ? e.touches[0].clientX : e.clientX;
    const py = e.touches ? e.touches[0].clientY : e.clientY;
    let a = (Math.atan2(py - cy, px - cx) * 180) / Math.PI;
    if (a < 0) a += 360;
    return a;
  }, []);

  const onMove = useCallback((e) => {
    if (!dragging.current) return;
    e.preventDefault();
    onChange(angleToVal(getAngle(e)));
  }, [getAngle, angleToVal, onChange]);

  const onUp = useCallback(() => {
    dragging.current = false;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', onUp);
  }, [onMove]);

  const onDown = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    onChange(angleToVal(getAngle(e)));
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }, [getAngle, angleToVal, onChange, onMove, onUp]);

  // Gradient ID unique per instance
  const gradId = 'speed-grad';

  // Tick marks at 0.5, 0.75, 1.0, 1.25, 1.5
  const presets = [0.5, 0.75, 1.0, 1.25, 1.5];
  const ticks = presets.map(v => {
    const f = (v - min) / (max - min);
    const a = START + f * SWEEP;
    const o = pol(CX, CY, R + 7, a);
    const i = pol(CX, CY, R + 3, a);
    const active = value >= v;
    return { v, o, i, a, active, f };
  });

  // Small labels at min, center, max
  const labelPositions = [
    { v: min, label: `${min}x` },
    { v: 1.0, label: '1x' },
    { v: max, label: `${max}x` },
  ];

  return (
    <div className="flex flex-col items-center" style={{ userSelect: 'none' }}>
      <svg ref={ref} width={SIZE} height={SIZE}
        style={{ cursor: 'pointer', touchAction: 'none', overflow: 'visible' }}
        onMouseDown={onDown} onTouchStart={onDown}>

        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="50%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#a78bfa" />
          </linearGradient>
          <filter id="speed-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background track */}
        <path d={arc(CX, CY, R, START, END)}
          fill="none" stroke="#1e1e38" strokeWidth={STROKE} strokeLinecap="round" />

        {/* Active track with gradient */}
        {frac > 0.005 && (
          <path d={arc(CX, CY, R, START, curAngle)}
            fill="none" stroke={`url(#${gradId})`} strokeWidth={STROKE} strokeLinecap="round" />
        )}

        {/* Tick marks */}
        {ticks.map(t => (
          <line key={t.v} x1={t.i.x} y1={t.i.y} x2={t.o.x} y2={t.o.y}
            stroke={t.active ? '#8b5cf6' : '#2a2a40'}
            strokeWidth={t.v === 1.0 ? 2 : 1}
            strokeLinecap="round"
            opacity={t.active ? 1 : 0.5} />
        ))}

        {/* Scale labels */}
        {labelPositions.map(lp => {
          const f = (lp.v - min) / (max - min);
          const a = START + f * SWEEP;
          const p = pol(CX, CY, R + 14, a);
          return (
            <text key={lp.v} x={p.x} y={p.y}
              textAnchor="middle" dominantBaseline="middle"
              fill="#444" fontSize="7" fontFamily="monospace">
              {lp.label}
            </text>
          );
        })}

        {/* Thumb glow */}
        <circle cx={thumb.x} cy={thumb.y} r={7}
          fill="none" stroke="#8b5cf6" strokeWidth={2} opacity={0.3}
          filter="url(#speed-glow)" />

        {/* Thumb */}
        <circle cx={thumb.x} cy={thumb.y} r={5}
          fill="#fff" stroke="#8b5cf6" strokeWidth={2}
          style={{ filter: 'drop-shadow(0 0 4px rgba(139,92,246,0.6))' }} />

        {/* Center value */}
        <text x={CX} y={CY - 1} textAnchor="middle" dominantBaseline="middle"
          fill="var(--text-primary)" fontSize="14" fontFamily="monospace" fontWeight="700">
          {value.toFixed(2)}
        </text>
        <text x={CX} y={CY + 11} textAnchor="middle" dominantBaseline="middle"
          fill="#555" fontSize="7" fontFamily="sans-serif" letterSpacing="1">
          SPEED
        </text>
      </svg>
    </div>
  );
}
