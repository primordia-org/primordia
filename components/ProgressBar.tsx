interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  className?: string;
}

export function ProgressBar({ value, max = 100, label, className = "" }: ProgressBarProps) {
  const safeMax = max > 0 ? max : 100;
  const percentage = Math.min(100, Math.max(0, (value / safeMax) * 100));
  const roundedPercentage = Math.round(percentage);

  return (
    <div className={className}>
      {label ? (
        <div className="mb-1.5 flex items-center justify-between text-xs text-gray-400">
          <span>{label}</span>
          <span className="font-mono text-gray-300">{roundedPercentage}%</span>
        </div>
      ) : null}
      <div
        className="h-3 overflow-hidden rounded-full border border-blue-400/20 bg-gray-900 shadow-inner shadow-black/40"
        role="progressbar"
        aria-valuenow={roundedPercentage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Progress"}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400 shadow-[0_0_16px_rgba(34,211,238,0.45)] transition-all duration-500 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
