"use client";

import { useEffect, useState } from "react";

interface LocalizedTimestampProps {
  timestamp: number;
  serverText: string;
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
  serverText,
  className,
}: LocalizedTimestampProps) {
  const [localized, setLocalized] = useState<{ timestamp: number; text: string } | null>(null);

  useEffect(() => {
    setLocalized({ timestamp, text: formatLocalizedTimestamp(timestamp) });
  }, [timestamp]);

  return <span className={className}>{localized?.timestamp === timestamp ? localized.text : serverText}</span>;
}
