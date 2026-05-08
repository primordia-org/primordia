/**
 * Converts UTC time strings in various formats to the browser's local timezone.
 *
 * Handles patterns like:
 *   - "10:30pm (UTC)" → "2:30pm (local timezone)"
 *   - "resets 10:30pm (UTC)" → "resets 2:30pm (local timezone)"
 *   - "at 10:30pm UTC" → "at 2:30pm local"
 */

export function convertUtcTimeToLocal(text: string): string {
  // Pattern: captures time + optional AM/PM + (UTC) or UTC at end
  // Examples: "10:30pm (UTC)", "10:30pm UTC", "10:30 (UTC)"
  const utcTimePattern = /(\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm|AM|PM))?)\s*\(?\s*UTC\s*\)?$/i;

  // Pattern: "resets 10:30pm (UTC)" - time preceded by context
  const contextTimePattern = /(\b(?:resets?|at|until|by|until)\s+)(\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm|AM|PM))?)\s*\(?\s*UTC\s*\)?$/i;

  // Check context-time pattern first (has preceding text)
  const contextMatch = text.match(contextTimePattern);
  if (contextMatch) {
    const [, context, timeStr] = contextMatch;
    const converted = convertTimeStrToLocale(timeStr);
    return text.replace(contextTimePattern, `${context}${converted}`);
  }

  // Check standalone time pattern
  const standaloneMatch = text.match(utcTimePattern);
  if (standaloneMatch) {
    const [, timeStr] = standaloneMatch;
    const converted = convertTimeStrToLocale(timeStr);
    return text.replace(utcTimePattern, converted);
  }

  return text;
}

function convertTimeStrToLocale(timeStr: string): string {
  // Parse time string like "10:30pm" or "10:30"
  const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})(?:\s*(am|pm|AM|PM))?/);
  if (!timeMatch) return timeStr;

  let hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2], 10);
  let ampm = timeMatch[3]?.toLowerCase();

  // Convert to 24-hour if AM/PM not specified
  if (!ampm) {
    // Assume 24-hour format if no AM/PM
    if (hours >= 12) {
      hours -= 12;
      ampm = 'pm';
    } else {
      ampm = 'am';
    }
  }

  // Convert to 24-hour for Date object
  let hours24 = hours;
  if (ampm === 'pm' && hours !== 12) hours24 += 12;
  if (ampm === 'am' && hours === 12) hours24 = 0;

  // Create a Date in UTC
  const now = new Date();
  const utcDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), hours24, minutes));

  // Format in local timezone
  const localHours = utcDate.getHours();
  const localMinutes = utcDate.getMinutes();
  const localAmPm = localHours >= 12 ? 'pm' : 'am';
  const displayHours = localHours % 12 || 12;

  return `${displayHours}:${String(localMinutes).padStart(2, '0')}${localAmPm}`;
}
