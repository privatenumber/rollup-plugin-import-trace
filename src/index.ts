import type { Plugin, RollupError } from 'rollup';

/**
 * Rollup error with import trace property
 */
export type RollupErrorWithTrace = RollupError & {
	importTrace?: string[];
};

/**
 * Vite module from moduleGraph
 */
type ViteModule = {
	id: string | null;
	importers: Set<ViteModule>;
};

/**
 * Vite dev server (minimal type for what we need)
 */
type ViteDevServer = {
	moduleGraph: {
		getModuleById: (id: string) => ViteModule | undefined;
	};
	middlewares: {
		use: (handler: ViteErrorMiddleware) => void;
	};
};

/**
 * Vite/Connect error middleware signature
 */
type ViteErrorMiddleware = (
	error: RollupErrorWithTrace,
	request: unknown,
	response: unknown,
	next: (error?: unknown) => void,
) => void;

type RollupVitePlugin = Plugin & {
	configureServer?: (server: ViteDevServer) => (() => void) | void;
};

type ModuleInfo = {
	importedIds: readonly string[];
	dynamicallyImportedIds: readonly string[];
};

type GetModuleInfo = (id: string) => ModuleInfo | null;

// Matches indentation of error stack traces
const indent = '    ';
const traceHeader = '\n\nImport trace:\n';

const formatTrace = (trace: string[]) => `${traceHeader}${trace
	.map((filePath, index) => {
		const prefix = index === 0 ? indent : `${indent}↳ `;
		return `${prefix}${filePath}`;
	})
	.join('\n')}\n`;

/**
 * Patches an error's message with its import trace.
 * Reads the `importTrace` property and appends a formatted trace to the message.
 */
export const patchErrorWithTrace = (error: unknown): void => {
	if (
		typeof error === 'object'
		&& error !== null
		&& 'message' in error
		&& typeof error.message === 'string'
		&& 'importTrace' in error
		&& Array.isArray(error.importTrace)
		&& !error.message.includes(traceHeader)
	) {
		error.message += formatTrace(error.importTrace);
	}
};

const getErrorFile = (
	error: RollupError & { path?: string },
) => (error.id ?? error.loc?.file ?? error.exporter ?? error.path);

// Build importer map on-demand from Rollup's module graph.
// importedIds is populated after resolveId completes for each import,
// so this data is available even when moduleParsed never fired.
const buildImporterMap = (
	getModuleIds: () => IterableIterator<string>,
	getModuleInfo: GetModuleInfo,
) => {
	const importerMap = new Map<string, string>();
	for (const id of getModuleIds()) {
		const info = getModuleInfo(id);
		if (info) {
			for (const importedId of info.importedIds) {
				if (!importerMap.has(importedId)) {
					importerMap.set(importedId, id);
				}
			}
			for (const importedId of info.dynamicallyImportedIds) {
				if (!importerMap.has(importedId)) {
					importerMap.set(importedId, id);
				}
			}
		}
	}
	return importerMap;
};

// Walk importer map from module back to entry point
const getTrace = (
	moduleId: string,
	importerMap: Map<string, string>,
): string[] => {
	const trace: string[] = [];
	let current: string | undefined = moduleId;
	const visited = new Set<string>();

	while (current && !visited.has(current)) {
		visited.add(current);
		trace.push(current);
		current = importerMap.get(current);
	}

	// eslint-disable-next-line unicorn/no-array-reverse -- toReversed requires ES2023
	return trace.reverse();
};

// Extract subpath from an import specifier for fuzzy matching.
// Relative: ./protos/a/b.ts → protos/a/b.ts
// Scoped bare: @scope/pkg/a/b.ts → a/b.ts
// Bare: pkg/a/b.ts → a/b.ts
const getSubpath = (source: string): string | undefined => {
	if (source.startsWith('.')) {
		return source.replace(/^\.\//, '');
	}
	if (source.startsWith('@')) {
		const secondSlash = source.indexOf('/', source.indexOf('/') + 1);
		return secondSlash === -1 ? undefined : source.slice(secondSlash + 1);
	}
	const firstSlash = source.indexOf('/');
	return firstSlash === -1 ? undefined : source.slice(firstSlash + 1);
};

// Replay recorded resolveId calls to recover import relationships
// that Rollup drops when a plugin's resolveId hook THROWS (not returns null).
// Null returns mean "not my concern" — Rollup continues to the next plugin.
// Throws abort resolution entirely, leaving importedIds/importers empty.
const replayResolveRecords = async (
	moduleId: string,
	importerMap: Map<string, string>,
	resolveRecords: Array<[source: string, importer: string]>,
	resolve: (
		source: string,
		importer: string,
		options: { skipSelf: boolean },
	) => Promise<{ id: string } | null>,
) => {
	for (const [source, importer] of resolveRecords) {
		try {
			const resolved = await resolve(source, importer, { skipSelf: true });
			if (resolved && !importerMap.has(resolved.id)) {
				importerMap.set(resolved.id, importer);
			}
		} catch {
			// Uses includes() not endsWith() because the specifier extension
			// may differ from the resolved path (e.g. .ts vs .ts.js)
			const subpath = getSubpath(source);
			if (subpath && moduleId.includes(subpath)) {
				importerMap.set(moduleId, importer);
			}
		}

		// Stop once the error module has a known importer
		if (importerMap.has(moduleId)) {
			break;
		}
	}
};

/**
 * Creates a Rollup/Vite plugin that automatically appends import traces to build errors.
 *
 * When a build error occurs, the error message is enhanced with the full import chain
 * showing how the problematic module was reached from the entry point.
 *
 * @example
 * ```ts
 * import { rollup } from 'rollup';
 * import { importTrace } from 'rollup-plugin-import-trace';
 *
 * // Errors automatically include import trace
 * await rollup({ input: 'src/index.js', plugins: [importTrace()] });
 * ```
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from 'vite';
 * import { importTrace } from 'rollup-plugin-import-trace';
 *
 * export default defineConfig({
 *   plugins: [importTrace()],
 * });
 * ```
 */
export const importTrace = (): RollupVitePlugin => {
	// Track resolveId calls to recover relationships that Rollup
	// hasn't recorded when resolution fails mid-chain.
	// Replayed sequentially in buildEnd (only on error) with early exit.
	// Lightweight: two string references per import, cleared each build
	const resolveRecords: Array<[source: string, importer: string]> = [];

	// Build trace using Vite's moduleGraph
	const getViteTrace = (
		module_: ViteModule | undefined,
		visited = new Set<string>(),
	): string[] => {
		if (!module_?.id || visited.has(module_.id)) {
			return [];
		}
		visited.add(module_.id);

		if (module_.importers.size === 0) {
			return [module_.id];
		}

		const firstImporter = [...module_.importers][0];
		return [...getViteTrace(firstImporter, visited), module_.id];
	};

	return {
		name: 'import-trace',

		// Vite dev: return function to register post-middleware
		configureServer(server) {
			return () => {
				// 4-param signature = error middleware (only called when next(error) is invoked)
				server.middlewares.use((error, _request, _response, next) => {
					const file = getErrorFile(error);
					if (file) {
						const module_ = server.moduleGraph.getModuleById(file);
						const trace = getViteTrace(module_);
						if (trace.length > 1) {
							(error as RollupErrorWithTrace).importTrace = trace;
							patchErrorWithTrace(error);
						}
					}
					next(error);
				});
			};
		},

		buildStart: () => {
			resolveRecords.length = 0;
		},

		// Capture every resolution attempt so we can recover
		// relationships that Rollup drops when resolveId fails mid-chain
		resolveId(source, importer) {
			if (importer) {
				resolveRecords.push([source, importer]);
			}
			return null;
		},

		async buildEnd(error) {
			if (!error) {
				return;
			}

			const moduleId = getErrorFile(error);
			if (!moduleId) {
				return;
			}

			const importerMap = buildImporterMap(
				() => this.getModuleIds(),
				id => this.getModuleInfo(id),
			);

			let trace = getTrace(moduleId, importerMap);

			if (trace.length <= 1) {
				// Graph walk failed — the error module has no recorded importer.
				// This only happens when a plugin's resolveId threw (e.g.
				// commonjs-resolver hitting ENOENT), which prevents Rollup
				// from recording the import edge. Standard "not found" errors
				// don't reach here: they either resolve normally or produce
				// UNRESOLVED_IMPORT warnings (not build errors).
				await replayResolveRecords(
					moduleId,
					importerMap,
					resolveRecords,
					this.resolve.bind(this),
				);
				trace = getTrace(moduleId, importerMap);
			}

			if (trace.length > 1) {
				(error as RollupErrorWithTrace).importTrace = trace;
				patchErrorWithTrace(error);
			}
		},

		// Handle errors during output generation (renderChunk, generateBundle).
		// buildEnd only receives build-phase errors; output-phase errors
		// (e.g. MISSING_EXPORT from chunk.generateExports) need renderError.
		// No replay needed — module graph is fully built by the output phase
		renderError(error) {
			if (!error) {
				return;
			}

			const moduleId = getErrorFile(error as RollupError & { path?: string });
			if (!moduleId) {
				return;
			}

			const importerMap = buildImporterMap(
				() => this.getModuleIds(),
				id => this.getModuleInfo(id),
			);

			const trace = getTrace(moduleId, importerMap);
			if (trace.length > 1) {
				(error as RollupErrorWithTrace).importTrace = trace;
				patchErrorWithTrace(error);
			}
		},
	};
};
