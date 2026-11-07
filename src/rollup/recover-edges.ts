import type { PluginContext } from 'rollup';
import { normalizePath } from '../utils/normalize-path.ts';

/**
 * A resolveId call the plugin recorded during the build
 */
export type ResolveRecord = [source: string, importer: string];

// Extract subpath from an import specifier for fuzzy matching.
// Relative: ./protos/a/b.ts → protos/a/b.ts
// Scoped bare: @scope/pkg/a/b.ts → a/b.ts
// Bare: pkg/a/b.ts → a/b.ts
const getSubpath = (source: string): string | undefined => {
	if (source.startsWith('.')) {
		// Only ./relative paths produce usable subpaths.
		// ../traversals can't match absolute moduleId paths.
		return source.startsWith('./') ? source.slice(2) : undefined;
	}
	if (source.startsWith('@')) {
		const secondSlash = source.indexOf('/', source.indexOf('/') + 1);
		return secondSlash === -1 ? undefined : source.slice(secondSlash + 1);
	}
	const firstSlash = source.indexOf('/');
	return firstSlash === -1 ? undefined : source.slice(firstSlash + 1);
};

/**
 * Replay recorded resolveId calls to recover the importer of `moduleId`.
 * Rollup records no import edge when a plugin's resolveId hook throws (a null
 * return only passes to the next plugin), so the module graph cannot reach the
 * failing module. Adds the recovered edge to `importerMap`.
 */
export const replayResolveRecords = async (
	moduleId: string,
	importerMap: Map<string, string>,
	resolveRecords: ResolveRecord[],
	context: PluginContext,
) => {
	for (const [source, importer] of resolveRecords) {
		const normalizedImporter = normalizePath(importer);
		try {
			const resolved = await context.resolve(source, importer, { skipSelf: true });
			if (resolved) {
				const normalizedId = normalizePath(resolved.id);
				if (!importerMap.has(normalizedId)) {
					importerMap.set(normalizedId, normalizedImporter);
				}
			}
		} catch {
			// Slash-prefixed includes() respects path boundaries while still
			// tolerating extension mismatches (e.g. "deep/types" vs "deep/types.d.ts")
			const subpath = getSubpath(source);
			if (subpath && moduleId.includes(`/${subpath}`)) {
				importerMap.set(moduleId, normalizedImporter);
			}
		}

		// Stop once the error module has a known importer
		if (importerMap.has(moduleId)) {
			break;
		}
	}
};
