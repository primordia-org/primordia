"use client";

import { useEffect, useState } from "react";

interface LocalizedTimestampClientProps {
  timestamp: number;
  options: Intl.DateTimeFormatOptions;
  serverText: string;
}

function formatTimestamp(timestamp: number, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(timestamp));
}

export function LocalizedTimestampClient({
  timestamp,
  options,
  serverText,
}: LocalizedTimestampClientProps) {
  const [text, setText] = useState(serverText);

  useEffect(() => {
    setText(formatTimestamp(timestamp, options));
  }, [timestamp, options]);

  return text;
}
