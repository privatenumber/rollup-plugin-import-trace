import type { RollupError } from 'rollup';
import { normalizePath } from './utils/normalize-path.ts';

/**
 * The files an error from Rollup or Vite points to, most specific first, with
 * forward slashes. `loc.file` is where the error happened. It can differ from
 * `id`, the module the error belongs to: for a CommonJS module whose required
 * file failed to parse, `id` is the requiring module and `loc.file` is the
 * required file. Rollup uses OS-native separators on Windows; normalizing
 * keeps map lookups and output consistent.
 */
export const getErrorFiles = (
	error: RollupError & { path?: string },
) => [...new Set(
	[error.loc?.file, error.id, error.exporter, error.path]
		.filter((file): file is string => typeof file === 'string' && file !== '')
		.map(file => normalizePath(file)),
)];
