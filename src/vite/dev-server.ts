import { attempt } from '../utils/attempt.ts';
import { findPathToRoot } from '../utils/find-path-to-root.ts';
import { getErrorFiles } from '../get-error-file.ts';
import { setImportTrace, type RollupErrorWithTrace } from '../patch-error.ts';

/**
 * Vite module from moduleGraph
 */
type ViteModule = {
	id: string | null;
	importers: Set<ViteModule>;
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

/**
 * Vite dev server (minimal type for what we need)
 */
export type ViteDevServer = {
	moduleGraph: {
		getModuleById: (id: string) => ViteModule | undefined;
	};
	middlewares: {
		use: (handler: ViteErrorMiddleware) => void;
	};
};

// The shortest chain from a module that nothing imports. Following only the
// first importer is not enough: Vite re-adds an importer when an edit restores
// its import, so the first one can be part of a cycle, and the chain would
// start in the middle of it.
const getViteTrace = (module_: ViteModule | undefined) => (
	module_?.id
		? findPathToRoot(
			module_,
			node => [...node.importers].filter(importer => importer.id),
		)?.map(node => node.id!) ?? []
		: []
);

/**
 * Register an error middleware that attaches import traces from Vite's
 * module graph. Call it from a configureServer post hook, so it runs before
 * Vite's own error middleware logs the error.
 */
export const addErrorMiddleware = (server: ViteDevServer) => {
	// 4-param signature = error middleware (only called when next(error) is invoked)
	server.middlewares.use((error, _request, _response, next) => {
		attempt(() => {
			// Use the most specific file that the module graph knows
			for (const file of getErrorFiles(error)) {
				const trace = getViteTrace(server.moduleGraph.getModuleById(file));
				if (trace.length > 1) {
					setImportTrace(error, trace);
					return;
				}
			}
		});
		next(error);
	});
};
