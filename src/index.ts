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
	// Shadow graph: moduleId -> importerId (first importer wins)
	const importerMap = new Map<string, string>();

	// Track resolveId calls to recover relationships that Rollup
	// hasn't recorded when resolution fails mid-chain.
	// Replayed sequentially in buildEnd (only on error) with early exit
	const resolveRecords: Array<[source: string, importer: string]> = [];

	const recordImports = (
		importerId: string,
		importedIds: readonly string[],
		dynamicallyImportedIds: readonly string[],
	) => {
		for (const importedId of importedIds) {
			if (!importerMap.has(importedId)) {
				importerMap.set(importedId, importerId);
			}
		}
		for (const importedId of dynamicallyImportedIds) {
			if (!importerMap.has(importedId)) {
				importerMap.set(importedId, importerId);
			}
		}
	};

	const getErrorFile = (
		error: RollupError & { path?: string },
	) => (error.id ?? error.loc?.file ?? error.exporter ?? error.path);

	// Build trace by walking importer map
	const getTrace = (moduleId: string): string[] => {
		const trace: string[] = [];
		let current: string | undefined = moduleId;
		const visited = new Set<string>();

		while (current && !visited.has(current)) {
			visited.add(current);
			trace.unshift(current);
			current = importerMap.get(current);
		}

		return trace;
	};

	const attachTrace = (error: RollupError) => {
		const moduleId = getErrorFile(error);
		if (moduleId) {
			const trace = getTrace(moduleId);
			if (trace.length > 1) {
				(error as RollupErrorWithTrace).importTrace = trace;
				patchErrorWithTrace(error);
			}
		}
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
	// that Rollup drops when resolution fails mid-chain
	const replayResolveRecords = async (
		moduleId: string,
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

		// Clear state between builds (critical for watch mode)
		buildStart: () => {
			importerMap.clear();
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

		// Track imports (only fires in build mode, not Vite dev)
		moduleParsed(moduleInfo) {
			recordImports(moduleInfo.id, moduleInfo.importedIds, moduleInfo.dynamicallyImportedIds);
		},

		async buildEnd(error) {
			if (!error) {
				return;
			}

			const moduleId = getErrorFile(error);
			if (!moduleId) {
				return;
			}

			// Try with existing importerMap first (populated by moduleParsed)
			let trace = getTrace(moduleId);

			if (trace.length <= 1) {
				// Supplement importerMap with Rollup's module info for modules
				// whose moduleParsed never fired (happens when a dependency fails
				// during transform — the entire ancestor chain misses moduleParsed)
				for (const id of this.getModuleIds()) {
					const info = this.getModuleInfo(id);
					if (info) {
						recordImports(id, info.importedIds, info.dynamicallyImportedIds);
					}
				}
				trace = getTrace(moduleId);
			}

			if (trace.length <= 1) {
				// Last resort: replay resolveId records to recover relationships
				// dropped when resolution fails mid-chain
				await replayResolveRecords(moduleId, this.resolve.bind(this));
				trace = getTrace(moduleId);
			}

			if (trace.length > 1) {
				(error as RollupErrorWithTrace).importTrace = trace;
				patchErrorWithTrace(error);
			}
		},

		// Handle errors during output generation (renderChunk, generateBundle)
		// buildEnd only receives build-phase errors; output-phase errors
		// (e.g. MISSING_EXPORT from chunk.generateExports) need renderError
		renderError(error) {
			if (error) {
				attachTrace(error as RollupError);
			}
		},
	};
};
