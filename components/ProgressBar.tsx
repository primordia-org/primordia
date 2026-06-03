interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  className?: string;
  /** Absolute progress values where visual tick marks should be drawn. */
  tickMarks?: number[];
}

export function ProgressBar({ value, max = 100, label, className = "", tickMarks = [] }: ProgressBarProps) {
  const safeMax = max > 0 ? max : 100;
  const percentage = Math.min(100, Math.max(0, (value / safeMax) * 100));
  const normalizedTickMarks = tickMarks
    .map((tick) => Math.min(100, Math.max(0, (tick / safeMax) * 100)))
    .filter((tick) => tick > 0 && tick < 100);

  return (
    <div className={className}>
      {label ? <div className="mb-1.5 text-xs text-gray-400">{label}</div> : null}
      <div
        className="relative h-3 overflow-hidden rounded-full border border-blue-400/20 bg-gray-900 shadow-inner shadow-black/40"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-label={label ?? "Progress"}
      >
        <div
          className="absolute inset-0 rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400 shadow-[0_0_16px_rgba(34,211,238,0.45)] transition-[clip-path] duration-500 ease-out"
          style={{ clipPath: `inset(0 ${100 - percentage}% 0 0)` }}
        />
        {normalizedTickMarks.map((tick) => (
          <span
            key={tick}
            aria-hidden="true"
            className="absolute top-0 z-10 h-full w-px -translate-x-1/2 bg-white/70 shadow-[0_0_4px_rgba(15,23,42,0.9)]"
            style={{ left: `${tick}%` }}
          />
        ))}
      </div>
    </div>
  );
}
