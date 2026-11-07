import type { RollupError } from 'rollup';
import { normalizePath } from './utils/normalize-path.ts';

/**
 * The file an error from Rollup or Vite belongs to, with forward slashes.
 * Rollup uses OS-native separators for module IDs and error properties on
 * Windows; normalizing keeps map lookups and output consistent.
 */
export const getErrorFile = (
	error: RollupError & { path?: string },
) => {
	const raw = error.id ?? error.loc?.file ?? error.exporter ?? error.path;
	return raw ? normalizePath(raw) : undefined;
};
