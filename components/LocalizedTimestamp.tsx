"use client";

import { useEffect, useState } from "react";

interface LocalizedTimestampProps {
  timestamp: number;
  className?: string;
}

function formatLocalizedTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(timestamp));
}

export function LocalizedTimestamp({
  timestamp,
  className,
}: LocalizedTimestampProps) {
  const [localized, setLocalized] = useState<{ timestamp: number; text: string } | null>(null);
  const fallbackText = formatLocalizedTimestamp(timestamp);

  useEffect(() => {
    setLocalized({ timestamp, text: formatLocalizedTimestamp(timestamp) });
  }, [timestamp]);

  return (
    <span className={className} suppressHydrationWarning>
      {localized?.timestamp === timestamp ? localized.text : fallbackText}
    </span>
  );
}
