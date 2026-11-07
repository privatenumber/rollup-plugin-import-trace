import { attempt } from '../utils/attempt.ts';
import { walkImporters } from '../utils/walk-importers.ts';
import { getErrorFile } from '../get-error-file.ts';
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

// Follow each module's first importer that Vite has identified
const getViteTrace = (module_: ViteModule | undefined) => (
	module_?.id
		? walkImporters(module_, (node) => {
			const importer = node.importers.values().next().value;
			return importer?.id ? importer : undefined;
		}).map(node => node.id!)
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
			const file = getErrorFile(error);
			if (file) {
				const trace = getViteTrace(server.moduleGraph.getModuleById(file));
				if (trace.length > 1) {
					setImportTrace(error, trace);
				}
			}
		});
		next(error);
	});
};
