import type { PluginContext, RollupError } from 'rollup';
import { attempt } from '../utils/attempt.ts';
import { normalizePath } from '../utils/normalize-path.ts';
import { walkImporters } from '../utils/walk-importers.ts';
import { getErrorFile } from '../get-error-file.ts';
import { setImportTrace } from '../patch-error.ts';
import { replayResolveRecords, type ResolveRecord } from './recover-edges.ts';

// Map each module to its first importer, from Rollup's module graph.
// importedIds is populated after resolveId completes for each import,
// so this data is available even when moduleParsed never fired.
const buildImporterMap = (context: PluginContext) => {
	const importerMap = new Map<string, string>();
	for (const id of context.getModuleIds()) {
		const info = context.getModuleInfo(id);
		if (info) {
			const normalizedId = normalizePath(id);
			for (const importedId of [...info.importedIds, ...info.dynamicallyImportedIds]) {
				const normalizedImportedId = normalizePath(importedId);
				if (!importerMap.has(normalizedImportedId)) {
					importerMap.set(normalizedImportedId, normalizedId);
				}
			}
		}
	}
	return importerMap;
};

const getTrace = (
	moduleId: string,
	importerMap: Map<string, string>,
) => walkImporters(moduleId, id => importerMap.get(id));

/**
 * Attach the import trace of the module that caused a Rollup error.
 * resolveRecords is only passed in the build phase, where Rollup can drop
 * import edges; by the output phase the module graph is complete.
 */
export const attachImportTrace = async (
	context: PluginContext,
	error: RollupError & { path?: string },
	resolveRecords?: ResolveRecord[],
) => {
	// A malformed error, such as a Proxy that throws on read, propagates as is
	const moduleId = attempt(() => getErrorFile(error));
	if (!moduleId) {
		return;
	}

	const importerMap = buildImporterMap(context);
	let trace = getTrace(moduleId, importerMap);

	if (trace.length <= 1 && resolveRecords) {
		// Graph walk failed — the error module has no recorded importer.
		// This only happens when a plugin's resolveId threw (e.g.
		// commonjs-resolver hitting ENOENT), which prevents Rollup
		// from recording the import edge. Standard "not found" errors
		// don't reach here: they either resolve normally or produce
		// UNRESOLVED_IMPORT warnings (not build errors).
		await replayResolveRecords(moduleId, importerMap, resolveRecords, context);
		trace = getTrace(moduleId, importerMap);
	}

	if (trace.length > 1) {
		setImportTrace(error, trace);
	}
};
