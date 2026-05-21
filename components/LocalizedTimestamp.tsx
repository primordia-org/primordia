import { LocalizedTimestampClient } from "./LocalizedTimestampClient";

interface LocalizedTimestampProps {
  timestamp: number;
  options: Intl.DateTimeFormatOptions;
}

function formatServerTimestamp(timestamp: number, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(timestamp));
}

export function LocalizedTimestamp({ timestamp, options }: LocalizedTimestampProps) {
  return (
    <LocalizedTimestampClient
      timestamp={timestamp}
      options={options}
      serverText={formatServerTimestamp(timestamp, options)}
    />
  );
}
