import type { Plugin } from 'rollup';
import type { ResolveRecord } from './rollup/recover-edges.ts';
import { attachImportTrace } from './rollup/trace.ts';
import { addErrorMiddleware, type ViteDevServer } from './vite/dev-server.ts';

export { patchErrorWithTrace, type RollupErrorWithTrace } from './patch-error.ts';

type RollupVitePlugin = Plugin & {
	enforce?: 'pre' | 'post';
	configureServer?: (server: ViteDevServer) => (() => void) | void;
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
	const resolveRecords: ResolveRecord[] = [];

	// A Vite dev server can resolve imports for its whole lifetime without
	// calling buildStart again, so records would keep growing. Dev errors are
	// traced from Vite's module graph instead, so nothing replays them.
	// Vite calls closeBundle when the server closes, which re-enables
	// recording for a later build that reuses this plugin instance.
	let isDevServer = false;

	return {
		name: 'import-trace',

		// Vite runs its own resolver (vite:resolve) before normal plugins, and it
		// ends the resolveId chain. In builds, commonjs--resolver resolves
		// imports through that chain and then loads modules that may be
		// CommonJS, so a syntax error in node_modules can throw from resolveId.
		// Running first lets resolveId record the import before vite:resolve
		// claims it. Rollup ignores this.
		enforce: 'pre',

		// Vite dev: return function to register post-middleware
		configureServer: (server) => {
			isDevServer = true;
			return () => addErrorMiddleware(server);
		},

		buildStart: () => {
			resolveRecords.length = 0;
		},

		// Capture every resolution attempt so we can recover
		// relationships that Rollup drops when resolveId fails mid-chain
		resolveId: (source, importer) => {
			if (importer && !isDevServer) {
				resolveRecords.push([source, importer]);
			}
			return null;
		},

		closeBundle: () => {
			isDevServer = false;
		},

		async buildEnd(error) {
			if (error) {
				// eslint-disable-next-line unicorn/no-this-outside-of-class -- Rollup passes the plugin context as `this` (https://github.com/pvtnbr/lintroll/issues/48)
				await attachImportTrace(this, error, resolveRecords);
			}
		},

		// Handle errors during output generation (renderChunk, generateBundle).
		// buildEnd only receives build-phase errors; output-phase errors
		// (e.g. MISSING_EXPORT from chunk.generateExports) need renderError.
		async renderError(error) {
			if (error) {
				// eslint-disable-next-line unicorn/no-this-outside-of-class -- Rollup passes the plugin context as `this` (https://github.com/pvtnbr/lintroll/issues/48)
				await attachImportTrace(this, error);
			}
		},
	};
};
