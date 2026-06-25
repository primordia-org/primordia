export function renderTable(headers: readonly string[], rows: string[][]): string {
  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map((row) => row[i]?.length ?? 0)));
  const border = `┌${widths.map((width) => '─'.repeat(width + 2)).join('┬')}┐`;
  const separator = `├${widths.map((width) => '─'.repeat(width + 2)).join('┼')}┤`;
  const bottom = `└${widths.map((width) => '─'.repeat(width + 2)).join('┴')}┘`;
  const renderRow = (values: readonly string[]) => `│${values.map((value, i) => ` ${value.padEnd(widths[i])} `).join('│')}│`;

  return [
    border,
    renderRow(headers),
    separator,
    ...rows.map((row) => renderRow(row)),
    bottom,
  ].join('\n');
}
