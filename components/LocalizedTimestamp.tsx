import { LocalizedTimestampClient } from "./LocalizedTimestampClient";

interface LocalizedTimestampProps {
  timestamp: number;
}

function formatServerTimestamp(timestamp: number): string {
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

export function LocalizedTimestamp({ timestamp }: LocalizedTimestampProps) {
  return (
    <LocalizedTimestampClient
      timestamp={timestamp}
      serverText={formatServerTimestamp(timestamp)}
    />
  );
}
