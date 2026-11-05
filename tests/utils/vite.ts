import type { Server } from 'node:http';
import {
	build,
	createLogger,
	createServer,
	type InlineConfig,
} from 'vite';

/**
 * Run a Vite library build of the fixture's index.js
 */
export const viteBuild = (
	root: string,
	config: InlineConfig,
) => build({
	root,
	configFile: false,
	envFile: false,
	logLevel: 'silent',
	...config,
	build: {
		write: false,
		lib: {
			entry: 'index.js',
			formats: ['es'],
		},
	},
});

/**
 * Start a Vite dev server. Dispose it with `await using`.
 *
 * `errors` collects the messages Vite logs for failed requests.
 * Vite logs the error object after the plugin's error middleware patched it.
 */
export const viteServe = async (
	root: string,
	config: InlineConfig,
) => {
	const errors: string[] = [];
	const logger = createLogger('silent');
	logger.error = (message) => {
		errors.push(message);
	};

	const server = await createServer({
		root,
		configFile: false,
		envFile: false,
		customLogger: logger,
		server: {
			port: 0,
			// Disable file watching to allow clean process exit
			watch: null,
		},
		...config,
	});
	await server.listen();

	return {
		url: server.resolvedUrls!.local[0]!.replace(/\/$/, ''),
		server,
		errors,
		[Symbol.asyncDispose]: async () => {
			// Keep-alive connections otherwise hold server.close() open on Windows
			(server.httpServer as Server | undefined)?.closeAllConnections();
			await server.close();
		},
	};
};
