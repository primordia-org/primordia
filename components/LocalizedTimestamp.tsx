"use client";

import { useEffect, useState } from "react";

interface LocalizedTimestampProps {
  timestamp: number;
  placeholder?: string;
  className?: string;
}

export function LocalizedTimestamp({
  timestamp,
  placeholder = "…",
  className,
}: LocalizedTimestampProps) {
  const [localized, setLocalized] = useState<string | null>(null);

  useEffect(() => {
    setLocalized(new Date(timestamp).toLocaleString());
  }, [timestamp]);

  return <span className={className}>{localized ?? placeholder}</span>;
}
