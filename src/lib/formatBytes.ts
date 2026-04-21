/**
 * Format a byte count as a human-readable string (e.g. "1.50 MB").
 *
 * @param bytes - the byte count to format
 * @param decimals - number of decimal places to include (default 2)
 * @returns formatted string with unit suffix
 */
export const formatBytes = (bytes: number, decimals = 2): string => {
  if (bytes === 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)

  return `${value.toFixed(decimals)} ${units[i]}`
}
