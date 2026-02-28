import { setTimeout } from 'node:timers/promises';
import {
	describe, test, expect, expectSnapshot, onTestFail,
} from 'manten';
import { createFixture } from 'fs-fixture';
import { viteServe } from '../utils/vite.js';
import { expectMatchesInOrder } from '../utils/expect-matches-in-order.js';
import { importTrace } from '../../src/index.js';

/**
 * Vite dev mode tests for rollup-plugin-import-trace
 *
 * In dev mode, the plugin detects the environment and avoids
 * unnecessary work (moduleParsed doesn't fire in Vite dev anyway).
 */
describe('Vite dev', () => {
	test('plugin works without errors in dev mode', async ({ signal } = {} as never) => {
		await using fixture = await createFixture({
			'index.html': '<script type="module" src="/index.js"></script>',
			'index.js': 'import { value } from "./a.js"; console.log(value);',
			'a.js': 'import { value } from "./b.js"; export { value };',
			'b.js': 'export const value = "hello";',
		});

		await viteServe(
			fixture.path,
			{ plugins: [importTrace()] },
			async (url) => {
				// Fetch module to trigger transforms
				const response = await fetch(`${url}/index.js`);
				expect(response.ok).toBe(true);
			},
			signal,
		);
	});

	test('syntax error includes import trace', async ({ signal } = {} as never) => {
		await using fixture = await createFixture({
			'index.html': `
			<!DOCTYPE html>
			<html>
			<body>
				<script type="module" src="/index.js"></script>
			</body>
			</html>
			`,
			'index.js': 'import { value } from "./a.js"; console.log(value);',
			'a.js': 'import { value } from "./b.js"; export { value };',
			'b.js': 'import { value } from "./broken.js"; export { value };',
			'broken.js': 'export const value = "unclosed',
		});

		await viteServe(
			fixture.path,
			{ plugins: [importTrace()] },
			async (url, server) => {
				// Fetch modules in order to build up the moduleGraph
				// (simulates browser following imports from entry point)
				// Vite processes imports lazily, so we must fetch the entire chain
				await fetch(`${url}/index.js`);
				await fetch(`${url}/a.js`);
				await fetch(`${url}/b.js`);

				// Wait for module graph to include broken.js
				// When b.js is transformed, Vite discovers the broken.js import
				// Check both maps: urlToModuleMap is reliably populated on Windows
				// while idToModuleMap may not be
				const hasBrokenModule = () => {
					const urlKeys = Array.from(server.moduleGraph.urlToModuleMap.keys());
					return urlKeys.some(moduleUrl => moduleUrl.endsWith('broken.js'));
				};
				while (!signal.aborted && !hasBrokenModule()) {
					await setTimeout(100);
				}

				// Request the broken module - Vite returns 500 with error HTML
				const response = await fetch(`${url}/broken.js`);
				const html = await response.text();
				onTestFail(() => {
					const brokenModule = server.moduleGraph.getModuleById(
						fixture.getPath('broken.js'),
					);
					console.log({
						response,
						html,
						moduleGraphUrls: Array.from(server.moduleGraph.urlToModuleMap.keys()),
						brokenModule: brokenModule
							? {
								id: brokenModule.id,
								url: brokenModule.url,
								transformResult: brokenModule.transformResult,
								importers: [...brokenModule.importers].map(m => m.id),
							}
							: null,
					});
				});
				expect(response.status).toBe(500);

				// The error HTML contains JSON-serialized error object on a single line
				const errorMatch = html.match(/const error = (.+)/);
				expect(errorMatch).toBeTruthy();

				const errorJson = JSON.parse(errorMatch![1].replaceAll(String.raw`\u003c`, '<'));

				// Verify error details
				expect(errorJson.message).toContain('invalid JS syntax');
				expect(errorJson.id).toContain('broken.js');

				// Verify import trace shows chain in order
				// Chain: index.js → a.js → b.js → broken.js
				expectMatchesInOrder(errorJson.message, [
					/Import trace:\n/,
					/index\.js\n/,
					/↳.*a\.js\n/,
					/↳.*b\.js\n/,
					/↳.*broken\.js/,
				]);
			},
			signal,
		);
	}, {
		timeout: 20_000,
		retry: 3,
	});
});
