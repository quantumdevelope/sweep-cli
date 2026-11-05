/**
 * Human-readable formatting helpers.
 */

/**
 * Format a byte count using binary units.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const decimals = value < 10 ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[unit]}`;
}

/**
 * Parse a size argument such as `10`, `512kb`, `4mb`, `1gb`.
 */
export function parseSize(input: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|k|m|g)?$/i.exec(input.trim());
  if (!match) throw new Error(`Invalid size: "${input}". Try 1024, 512kb, 4mb, 1gb.`);

  const amount = Number.parseFloat(match[1]!);
  const unit = (match[2] ?? 'b').toLowerCase();

  const multipliers: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
  return Math.round(amount * multipliers[unit]!);
}

/**
 * Format a number with thousands separators.
 */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}
