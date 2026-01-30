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

const formatTrace = (trace: string[]) => `\n\nImport trace:\n${trace
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

	const getErrorFile = (
		error: RollupError,
	) => (error.id ?? error.loc?.file);

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
							error.message += formatTrace(trace);
						}
					}
					next(error);
				});
			};
		},

		// Clear state between builds (critical for watch mode)
		buildStart: () => {
			importerMap.clear();
		},

		// Track imports (only fires in build mode, not Vite dev)
		moduleParsed(moduleInfo) {
			for (const importedId of moduleInfo.importedIds) {
				if (!importerMap.has(importedId)) {
					importerMap.set(importedId, moduleInfo.id);
				}
			}

			// Dynamic imports
			for (const importedId of moduleInfo.dynamicallyImportedIds) {
				if (!importerMap.has(importedId)) {
					importerMap.set(importedId, moduleInfo.id);
				}
			}
		},

		buildEnd(error) {
			if (!error) {
				return;
			}

			const moduleId = getErrorFile(error);
			if (moduleId) {
				const trace = getTrace(moduleId);
				if (trace.length > 1) {
					(error as RollupErrorWithTrace).importTrace = trace;
				}
			}
		},
	};
};
