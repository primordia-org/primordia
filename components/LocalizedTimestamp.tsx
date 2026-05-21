"use client";

import { useEffect, useState } from "react";

interface LocalizedTimestampProps {
  timestamp: number;
  className?: string;
}

function formatUtcPlaceholder(timestamp: number): string {
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(timestamp))} UTC`;
}

function formatLocalizedTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZoneName: "short",
  }).format(new Date(timestamp));
}

export function LocalizedTimestamp({
  timestamp,
  className,
}: LocalizedTimestampProps) {
  const [localized, setLocalized] = useState<string | null>(null);

  useEffect(() => {
    setLocalized(formatLocalizedTimestamp(timestamp));
  }, [timestamp]);

  return <span className={className}>{localized ?? formatUtcPlaceholder(timestamp)}</span>;
}
