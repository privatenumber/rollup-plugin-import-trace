import type { Server } from 'node:http';
import {
	build,
	createServer,
	type InlineConfig,
	type ViteDevServer,
} from 'vite';

/**
 * Run a Vite production build and return the output
 */
export const viteBuild = async (
	fixturePath: string,
	config?: InlineConfig,
) => {
	const warnings: string[] = [];
	const errors: Error[] = [];

	try {
		const built = await build({
			root: fixturePath,
			configFile: false,
			envFile: false,
			logLevel: 'silent',
			...config,

			build: {
				minify: false,
				outDir: 'dist',
				lib: {
					entry: 'index.js',
					formats: ['es'],
				},
				rollupOptions: {
					onwarn: ({ message }) => {
						warnings.push(message);
					},
				},
				...config?.build,
			},
		});

		if (!Array.isArray(built)) {
			throw new TypeError('Build result is not an array');
		}

		const { output } = built[0]!;

		return {
			js: output[0].code,
			warnings,
			errors,
			success: true as const,
		};
	} catch (error) {
		return {
			js: undefined,
			warnings,
			errors: [error as Error],
			success: false as const,
		};
	}
};

/**
 * Create a Vite dev server and run a callback with access to it
 */
export const viteServe = async <T>(
	fixturePath: string,
	config: InlineConfig | undefined,
	callback: (url: string, server: ViteDevServer) => Promise<T>,
	signal?: AbortSignal,
): Promise<T> => {
	const server = await createServer({
		root: fixturePath,
		configFile: false,
		envFile: false,
		logLevel: 'silent',
		server: {
			port: 0, // Random available port
			watch: null, // Disable file watching to allow clean process exit
		},
		...config,
	});

	await server.listen();

	// Remove trailing slash from URL
	const url = server.resolvedUrls!.local[0]!.replace(/\/$/, '');

	// Close server on abort signal
	signal?.addEventListener('abort', () => {
		(server.httpServer as Server | undefined)?.closeAllConnections();
		server.close();
	});

	try {
		return await callback(url, server);
	} finally {
		// Force close all connections to prevent hanging on Windows
		(server.httpServer as Server | undefined)?.closeAllConnections();
		await server.close();
	}
};

/**
 * Start Vite dev server and fetch a module's transformed code
 */
export const getViteDevModule = async (
	fixturePath: string,
	modulePath: string,
	config?: InlineConfig,
) => await viteServe(
	fixturePath,
	config,
	async (url) => {
		const response = await fetch(`${url}${modulePath}`);
		return response.text();
	},
);
