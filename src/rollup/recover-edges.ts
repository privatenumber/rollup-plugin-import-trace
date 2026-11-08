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

// Extract the subpath from a bare specifier for fuzzy matching.
// Scoped: @scope/pkg/a/b.ts → a/b.ts
// Unscoped: pkg/a/b.ts → a/b.ts
const getSubpath = (source: string): string | undefined => {
	if (source.startsWith('@')) {
		const secondSlash = source.indexOf('/', source.indexOf('/') + 1);
		return secondSlash === -1 ? undefined : source.slice(secondSlash + 1);
	}
	const firstSlash = source.indexOf('/');
	return firstSlash === -1 ? undefined : source.slice(firstSlash + 1);
};

// A specifier can leave out the extension or an index file
// (e.g. "deep/types" for "deep/types.d.ts")
const omittedSuffix = /^(?:\/index)?\.[^/]+$/;

// Whether a specifier whose resolution threw refers to moduleId.
// @rollup/plugin-commonjs also resolves modules by absolute path, which must
// match exactly. Both path styles are checked, so the result does not depend
// on the OS the build runs on.
const matchesModule = (
	source: string,
	importer: string,
	moduleId: string,
) => {
	if (path.posix.isAbsolute(source) || path.win32.isAbsolute(source)) {
		return normalizePath(source) === moduleId;
	}

	// A relative specifier refers to a path next to its importer. Matching
	// only its end would also accept another importer's module with the
	// same relative path, when several resolutions fail at once.
	if (/^\.\.?(?:\/|$)/.test(source)) {
		const target = path.posix.join(path.posix.dirname(normalizePath(importer)), source);
		return moduleId.startsWith(target) && (
			moduleId.length === target.length
			|| omittedSuffix.test(moduleId.slice(target.length))
		);
	}

	// Slash-prefixed includes() respects path boundaries while still
	// tolerating extension mismatches
	const subpath = getSubpath(source);
	return subpath !== undefined && moduleId.includes(`/${subpath}`);
};

/**
 * Replay recorded resolveId calls to recover the importer of `moduleId`.
 * Rollup records no import edge when a plugin's resolveId hook throws (a null
 * return only passes to the next plugin), so the module graph cannot reach the
 * failing module. Adds the recovered edge to `importerMap`.
 *
 * Records are replayed newest first, because each one runs the other plugins'
 * resolveId hooks again, until one returns a result. A failed resolution
 * usually stops the build soon after it is recorded, so it tends to be among
 * the last records. Replay still visits every record when the failing one is
 * old, such as a resolution that waited while many others completed, or when
 * no record matches.
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
			if (matchesModule(source, importer, moduleId)) {
				importerMap.set(moduleId, normalizedImporter);
			}
		}

		// Stop once the error module has a known importer
		if (importerMap.has(moduleId)) {
			break;
		}
	}
};
