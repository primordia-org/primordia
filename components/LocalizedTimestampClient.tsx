"use client";

import { useEffect, useState } from "react";

interface LocalizedTimestampClientProps {
  timestamp: number;
  serverText: string;
}

function formatTimestamp(timestamp: number): string {
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

export function LocalizedTimestampClient({
  timestamp,
  serverText,
}: LocalizedTimestampClientProps) {
  const [text, setText] = useState(serverText);

  useEffect(() => {
    setText(formatTimestamp(timestamp));
  }, [timestamp]);

  return text;
}
