import type { PluginContext, RollupError } from 'rollup';
import { attempt } from '../utils/attempt.ts';
import { normalizePath } from '../utils/normalize-path.ts';
import { walkImporters } from '../utils/walk-importers.ts';
import { getErrorFiles } from '../get-error-file.ts';
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

// The graph walk stops early when a plugin's resolveId threw (e.g.
// commonjs--resolver failing to parse a required file), because Rollup
// records no import edge for that resolution. Every module above the failure
// can be affected, not only the failing one: resolving a CommonJS package
// also loads it, so its broken require() drops the edge into the package too.
// Replay for the top of the chain until it reaches an entry module or no
// further edge can be recovered. Standard "not found" errors don't reach
// here: they either resolve normally or produce UNRESOLVED_IMPORT warnings.
const recoverTrace = async (
	moduleId: string,
	importerMap: Map<string, string>,
	resolveRecords: ResolveRecord[],
	context: PluginContext,
) => {
	let trace = getTrace(moduleId, importerMap);
	while (!context.getModuleInfo(trace[0]!)?.isEntry) {
		const { length } = trace;
		await replayResolveRecords(trace[0]!, importerMap, resolveRecords, context);
		trace = getTrace(moduleId, importerMap);
		if (trace.length === length) {
			break;
		}
	}
	return trace;
};

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
	const errorFiles = attempt(() => getErrorFiles(error)) ?? [];
	if (errorFiles.length === 0) {
		return;
	}

	// Use the most specific file that the module graph can reach
	const importerMap = buildImporterMap(context);
	for (const moduleId of errorFiles) {
		const trace = resolveRecords
			? await recoverTrace(moduleId, importerMap, resolveRecords, context)
			: getTrace(moduleId, importerMap);

		// A chain that does not reach an entry module would look complete but
		// start in the middle, so report none rather than a misleading one
		if (trace.length > 1 && context.getModuleInfo(trace[0]!)?.isEntry) {
			setImportTrace(error, trace);
			return;
		}
	}
};
