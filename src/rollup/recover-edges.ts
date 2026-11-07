import path from 'node:path';
import type { PluginContext } from 'rollup';
import { normalizePath } from '../utils/normalize-path.ts';

/**
 * A resolveId call the plugin recorded during the build. The options, such as
 * import attributes, can change what a resolver returns, so replay passes
 * them again.
 */
export type ResolveRecord = [
	source: string,
	importer: string,
	options: Parameters<PluginContext['resolve']>[2],
];

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

// Whether a specifier whose resolution threw refers to moduleId.
// @rollup/plugin-commonjs also resolves modules by absolute path, which must
// match exactly. Both path styles are checked, so the result does not depend
// on the OS the build runs on.
const matchesModule = (source: string, moduleId: string) => {
	if (path.posix.isAbsolute(source) || path.win32.isAbsolute(source)) {
		return normalizePath(source) === moduleId;
	}

	// Slash-prefixed includes() respects path boundaries while still
	// tolerating extension mismatches (e.g. "deep/types" vs "deep/types.d.ts")
	const subpath = getSubpath(source);
	return subpath !== undefined && moduleId.includes(`/${subpath}`);
};

/**
 * Replay recorded resolveId calls to recover the importer of `moduleId`.
 * Rollup records no import edge when a plugin's resolveId hook throws (a null
 * return only passes to the next plugin), so the module graph cannot reach the
 * failing module. Adds the recovered edge to `importerMap`.
 *
 * Records are replayed newest first. The failed resolution stops the build,
 * so it is among the last ones recorded, and each replay runs the whole
 * resolveId chain again. Replaying oldest first re-resolved every import in
 * the build before reaching it.
 */
export const replayResolveRecords = async (
	moduleId: string,
	importerMap: Map<string, string>,
	resolveRecords: ResolveRecord[],
	context: PluginContext,
) => {
	for (let index = resolveRecords.length - 1; index >= 0; index -= 1) {
		const [source, importer, options] = resolveRecords[index]!;
		const normalizedImporter = normalizePath(importer);
		try {
			const resolved = await context.resolve(source, importer, {
				...options,
				skipSelf: true,
			});
			if (resolved) {
				const normalizedId = normalizePath(resolved.id);
				if (!importerMap.has(normalizedId)) {
					importerMap.set(normalizedId, normalizedImporter);
				}
			}
		} catch {
			if (matchesModule(source, moduleId)) {
				importerMap.set(moduleId, normalizedImporter);
			}
		}

		// Stop once the error module has a known importer
		if (importerMap.has(moduleId)) {
			break;
		}
	}
};
