import type { Server } from 'node:http';
import { stripVTControlCharacters } from 'node:util';
import type * as vite7 from 'vite';

/**
 * The parts of a Vite version's API the tests use. Older versions are
 * installed under aliases (vite5, vite6) and cast to this type.
 */
export type Vite = Pick<typeof vite7, 'build' | 'createLogger' | 'createServer' | 'version'>;

/**
 * Build and dev server helpers for one Vite version
 */
export const createViteHelpers = (vite: Vite) => {
	/**
	 * Run a Vite library build of the fixture's index.js
	 */
	const viteBuild = (
		root: string,
		config: vite7.InlineConfig,
	) => vite.build({
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
	const viteServe = async (
		root: string,
		config: vite7.InlineConfig,
	) => {
		const errors: string[] = [];
		const logger = vite.createLogger('silent');
		// Vite colors messages when it detects CI
		logger.error = (message) => {
			errors.push(stripVTControlCharacters(message));
		};

		const server = await vite.createServer({
			root,
			configFile: false,
			envFile: false,
			customLogger: logger,
			server: {
				// With a host name such as `localhost`, Node.js can try several of
				// the addresses it resolves to, and a CI run failed requests with
				// ETIMEDOUT from that address selection. An IP address skips it.
				host: '127.0.0.1',
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

	return {
		viteBuild,
		viteServe,
	};
};
