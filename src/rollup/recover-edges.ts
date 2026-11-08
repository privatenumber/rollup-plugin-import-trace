import path from 'node:path';
import type { PluginContext, ResolvedId, RollupError } from 'rollup';
import { attempt } from '../utils/attempt.ts';
import { fromBothEnds } from '../utils/from-both-ends.ts';
import { normalizePath } from '../utils/normalize-path.ts';
import { timedOut, type Deadline } from '../utils/deadline.ts';
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

type Outcome = { resolved: ResolvedId | null } | { error: unknown };

// Apply what one replayed record shows about moduleId. Exact evidence adds an
// edge to importerMap: a resolution that succeeds, or a failing absolute
// specifier that names moduleId. @rollup/plugin-commonjs resolves modules
// again by absolute path, and both path styles are checked, so the result
// does not depend on the OS.
// Returns whether the replayed resolution threw an error whose file is
// moduleId. That is weaker evidence: the import leads to moduleId, but it can
// import moduleId through other modules. Matching the specifier against the
// path instead would let another import with a similar specifier claim the
// edge, such as a concurrent failure of the same relative path elsewhere.
// An error can also name the importer itself, as `id`, which is not an edge.
const applyOutcome = (
	[source, importer]: ResolveRecord,
	outcome: Outcome,
	moduleId: string,
	importerMap: Map<string, string>,
) => {
	const normalizedImporter = normalizePath(importer);
	if (!('error' in outcome)) {
		if (outcome.resolved) {
			const normalizedId = normalizePath(outcome.resolved.id);
			if (normalizedId !== normalizedImporter && !importerMap.has(normalizedId)) {
				importerMap.set(normalizedId, normalizedImporter);
			}
		}
		return false;
	}

	if (normalizedImporter === moduleId) {
		return false;
	}

	if (isAbsolute(source)) {
		if (normalizePath(source) === moduleId) {
			importerMap.set(moduleId, normalizedImporter);
		}
		return false;
	}

	const files = attempt(() => getErrorFiles(outcome.error as RollupError));
	return files?.includes(moduleId) ?? false;
};

/**
 * Replay recorded resolveId calls to recover the importers of modules that
 * the module graph cannot reach. Rollup records no import edge when a plugin's
 * resolveId hook throws (a null return only passes to the next plugin).
 *
 * Returns a function that recovers the importer of one module into
 * importerMap, and returns false when the deadline has passed. Each record is
 * resolved at most once per replay, and its outcome is reused for every
 * module, because each resolution runs the other plugins' resolveId hooks
 * again, until one returns a result.
 *
 * Replay works from both ends of the records, which are in the order the
 * resolutions started:
 * - A failed resolution usually stops the build soon after it starts, so it
 *   tends to be among the newest. A resolution nested inside another starts
 *   later, so among the records whose error names the module, the newest is
 *   the most direct import. Only the newest end accepts that evidence at once.
 * - A resolution that loads a package before it fails, such as
 *   @rollup/plugin-commonjs's, starts before every import inside the
 *   package, so it is among the oldest. The oldest end accepts only exact
 *   evidence, and keeps an error that names the module as a fallback.
 *
 * A resolver can wait forever once the build has failed, so each resolution
 * races the deadline.
 */
export const createReplay = (
	resolveRecords: ResolveRecord[],
	context: PluginContext,
	deadline: Deadline,
) => {
	const outcomes = new Map<number, Outcome>();
	const getOutcome = async (index: number) => {
		const cached = outcomes.get(index);
		if (cached) {
			return cached;
		}
		if (deadline.isPast()) {
			return timedOut;
		}

		const [source, importer, options] = resolveRecords[index]!;
		const outcome = await Promise.race([
			context.resolve(source, importer, {
				...options,
				skipSelf: true,
			}).then(
				(resolved): Outcome => ({ resolved }),
				(error: unknown): Outcome => ({ error }),
			),
			deadline.expired,
		]);
		if (outcome !== timedOut) {
			outcomes.set(index, outcome);
		}
		return outcome;
	};

	return async (moduleId: string, importerMap: Map<string, string>) => {
		let fallbackImporter: string | undefined;
		for (const { index, fromEnd } of fromBothEnds(resolveRecords.length)) {
			const outcome = await getOutcome(index);
			if (outcome === timedOut) {
				return false;
			}

			const record = resolveRecords[index]!;
			const namesModule = applyOutcome(record, outcome, moduleId, importerMap);

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
};
