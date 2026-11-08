import type { PluginContext, RollupError } from 'rollup';
import { attempt } from '../utils/attempt.ts';
import { normalizePath } from '../utils/normalize-path.ts';
import { createTimeout } from '../utils/timeout.ts';
import { walkImporters } from '../utils/walk-importers.ts';
import { getErrorFiles } from '../get-error-file.ts';
import { setImportTrace } from '../patch-error.ts';
import { replayResolveRecords, type ResolveRecord } from './recover-edges.ts';

// Map each module to its first importer, and collect the entry modules, from
// Rollup's module graph. IDs are normalized, so on Windows they no longer match
// Rollup's own IDs and cannot be passed back to getModuleInfo().
// importedIds is populated after resolveId completes for each import,
// so this data is available even when moduleParsed never fired.
const readModuleGraph = (context: PluginContext) => {
	const importerMap = new Map<string, string>();
	const entryIds = new Set<string>();
	for (const id of context.getModuleIds()) {
		const info = context.getModuleInfo(id);
		if (info) {
			const normalizedId = normalizePath(id);
			if (info.isEntry) {
				entryIds.add(normalizedId);
			}
			for (const importedId of [...info.importedIds, ...info.dynamicallyImportedIds]) {
				const normalizedImportedId = normalizePath(importedId);
				if (!importerMap.has(normalizedImportedId)) {
					importerMap.set(normalizedImportedId, normalizedId);
				}
			}
		}
	}
	return {
		importerMap,
		entryIds,
	};
};

// A scan of every record took about 2s in a failed 5,000-module build
// (notes/rollup-plugin-import-trace/replay.md)
const replayTimeLimit = 5000;

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
	{ importerMap, entryIds }: ReturnType<typeof readModuleGraph>,
	resolveRecords: ResolveRecord[],
	context: PluginContext,
) => {
	// The original error reaches the caller only after recovery, so recovery
	// gets a time budget
	const timeout = createTimeout(replayTimeLimit);
	let trace = getTrace(moduleId, importerMap);
	while (!entryIds.has(trace[0]!)) {
		const { length } = trace;
		const finished = await replayResolveRecords(
			trace[0]!,
			importerMap,
			resolveRecords,
			context,
			timeout,
		);
		trace = getTrace(moduleId, importerMap);
		if (!finished || trace.length === length) {
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
	const graph = readModuleGraph(context);
	for (const moduleId of errorFiles) {
		const trace = resolveRecords
			? await recoverTrace(moduleId, graph, resolveRecords, context)
			: getTrace(moduleId, graph.importerMap);

		// A chain that does not reach an entry module would look complete but
		// start in the middle, so report none rather than a misleading one
		if (trace.length > 1 && graph.entryIds.has(trace[0]!)) {
			setImportTrace(error, trace);
			return;
		}
	}
};
