import path from 'node:path';
import type { PluginContext, RollupError } from 'rollup';
import { attempt } from '../utils/attempt.ts';
import { fromBothEnds } from '../utils/from-both-ends.ts';
import { normalizePath } from '../utils/normalize-path.ts';
import { timedOut } from '../utils/timeout.ts';
import { getErrorFiles } from '../get-error-file.ts';

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

const isAbsolute = (source: string) => (
	path.posix.isAbsolute(source) || path.win32.isAbsolute(source)
);

// Replay one record. Exact evidence adds an edge to importerMap: a resolution
// that succeeds, or a failing absolute specifier that names moduleId.
// @rollup/plugin-commonjs resolves modules again by absolute path, and both
// path styles are checked, so the result does not depend on the OS.
// Returns whether the replayed resolution threw an error whose file is
// moduleId. That is weaker evidence: the import leads to moduleId, but it can
// import moduleId through other modules. Matching the specifier against the
// path instead would let another import with a similar specifier claim the
// edge, such as a concurrent failure of the same relative path elsewhere.
const replayRecord = async (
	[source, importer, options]: ResolveRecord,
	moduleId: string,
	importerMap: Map<string, string>,
	context: PluginContext,
	timeout: Promise<typeof timedOut>,
) => {
	const resolution = context.resolve(source, importer, {
		...options,
		skipSelf: true,
	}).then(
		resolved => ({ resolved }),
		(error: unknown) => ({ error }),
	);
	const outcome = await Promise.race([resolution, timeout]);
	if (outcome === timedOut) {
		return timedOut;
	}

	if (!('error' in outcome)) {
		if (outcome.resolved) {
			const normalizedId = normalizePath(outcome.resolved.id);
			if (!importerMap.has(normalizedId)) {
				importerMap.set(normalizedId, normalizePath(importer));
			}
		}
		return false;
	}

	if (isAbsolute(source)) {
		if (normalizePath(source) === moduleId) {
			importerMap.set(moduleId, normalizePath(importer));
		}
		return false;
	}

	const files = attempt(() => getErrorFiles(outcome.error as RollupError));
	return files?.includes(moduleId) ?? false;
};

/**
 * Replay recorded resolveId calls to recover the importer of `moduleId`.
 * Rollup records no import edge when a plugin's resolveId hook throws (a null
 * return only passes to the next plugin), so the module graph cannot reach the
 * failing module. Adds the recovered edge to `importerMap`.
 *
 * Each replayed record runs the other plugins' resolveId hooks again, until
 * one returns a result, so replay works from both ends of the records, which
 * are in the order the resolutions started:
 * - A failed resolution usually stops the build soon after it starts, so it
 *   tends to be among the newest. A resolution nested inside another starts
 *   later, so among the records whose error names moduleId, the newest is the
 *   most direct import. Only the newest end accepts that evidence at once.
 * - A resolution that loads a package before it fails, such as
 *   @rollup/plugin-commonjs's, starts before every import inside the
 *   package, so it is among the oldest. The oldest end accepts only exact
 *   evidence, and keeps an error that names moduleId as a fallback.
 * Replay still visits every record once when no record matches.
 *
 * A resolver can wait forever once the build has failed, so each resolution
 * races `timeout`. Returns false when the time ran out.
 */
export const replayResolveRecords = async (
	moduleId: string,
	importerMap: Map<string, string>,
	resolveRecords: ResolveRecord[],
	context: PluginContext,
	timeout: Promise<typeof timedOut>,
) => {
	let fallbackImporter: string | undefined;
	for (const { index, fromEnd } of fromBothEnds(resolveRecords.length)) {
		const record = resolveRecords[index]!;
		const namesModule = await replayRecord(record, moduleId, importerMap, context, timeout);
		if (namesModule === timedOut) {
			return false;
		}

		// The end descends, so its first such record is the newest overall.
		// The start ascends, so the fallback keeps the newest it has seen.
		if (namesModule && fromEnd) {
			importerMap.set(moduleId, normalizePath(record[1]));
		} else if (namesModule) {
			fallbackImporter = record[1];
		}

		if (importerMap.has(moduleId)) {
			return true;
		}
	}

	if (fallbackImporter !== undefined) {
		importerMap.set(moduleId, normalizePath(fallbackImporter));
	}
	return true;
};
