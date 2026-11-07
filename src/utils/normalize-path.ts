/**
 * Convert Windows path separators to forward slashes
 */
export const normalizePath = (filePath: string) => filePath.replaceAll('\\', '/');
