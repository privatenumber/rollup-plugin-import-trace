import { describe, test, expect } from 'manten';
import type { PluginContext } from 'rollup';
import { createFixture } from 'fs-fixture';
import { formatTrace, expectNoTrace } from '../utils/trace.ts';
import { viteServe } from '../utils/vite.ts';
import { importTrace } from '../../src/index.ts';

// A request that never settles aborts at the timeout, so the server is still disposed
const timeout = 10_000;

describe('Vite dev', () => {
	test('serves transformed modules', async ({ signal }) => {
		await using fixture = await createFixture({
			'index.js': 'import { value } from "./a.js"; console.log(value);',
			'a.js': 'export const value = "hello";',
		});
		await using dev = await viteServe(fixture.path, { plugins: [importTrace()] });

		const response = await fetch(`${dev.url}/index.js`, { signal });
		expect(response.status).toBe(200);

		// Vite rewrites relative imports, so a raw static response fails here
		expect(await response.text()).toContain('from "/a.js"');
	}, timeout);

	test('syntax error', async ({ signal }) => {
		await using fixture = await createFixture({
			'index.js': 'import { value } from "./a.js"; console.log(value);',
			'a.js': 'import { value } from "./b.js"; export { value };',
			'b.js': 'import { value } from "./broken.js"; export { value };',
			'broken.js': 'export const value = "unclosed',
		});
		await using dev = await viteServe(fixture.path, { plugins: [importTrace()] });

		// Vite builds the module graph lazily, like a browser following imports
		for (const file of ['index.js', 'a.js', 'b.js']) {
			const response = await fetch(`${dev.url}/${file}`, { signal });
			expect(response.status).toBe(200);
		}

		const response = await fetch(`${dev.url}/broken.js`, { signal });
		expect(response.status).toBe(500);

		// Vite also logs a "Pre-transform error" when it pre-transforms b.js's
		// imports; only the request error goes through the error middleware
		const requestErrors = dev.errors.filter(message => message.startsWith('Internal server error'));
		expect(requestErrors).toHaveLength(1);
		expect(requestErrors[0]).toContain(
			formatTrace(fixture, ['index.js', 'a.js', 'b.js', 'broken.js']),
		);
	}, timeout);

	test('no trace for a module without importers', async ({ signal }) => {
		await using fixture = await createFixture({
			'broken.js': 'export const value = "unclosed',
		});
		await using dev = await viteServe(fixture.path, { plugins: [importTrace()] });

		const response = await fetch(`${dev.url}/broken.js`, { signal });
		expect(response.status).toBe(500);
		expect(dev.errors).toHaveLength(1);
		expect(dev.errors[0]).toMatch(/^Internal server error/);
		expect(dev.errors[0]).not.toContain('Import trace:');
	}, timeout);

	/**
	 * Vite calls buildStart once per server but resolveId for every request,
	 * so resolveId records must not accumulate for the server's lifetime.
	 *
	 * Vite only calls buildEnd when the server closes, so this test calls it
	 * directly. Replay calls context.resolve() once per retained record.
	 */
	test('resolveId records are not retained', async ({ signal }) => {
		await using fixture = await createFixture({
			'index.js': 'import { value } from "./a.js"; console.log(value);',
			'a.js': 'export const value = "hello";',
		});
		const plugin = importTrace();
		await using dev = await viteServe(fixture.path, { plugins: [plugin] });

		// Vite resolves ./a.js from index.js through the plugin's resolveId
		const response = await fetch(`${dev.url}/index.js`, { signal });
		expect(response.status).toBe(200);

		const error = Object.assign(new Error('ENOENT'), { path: fixture.getPath('a.js') });
		let resolveCalls = 0;
		const context = {
			getModuleIds: () => [].values(),
			getModuleInfo: () => null,
			resolve: () => {
				resolveCalls += 1;
				return Promise.reject(new Error('Unresolvable'));
			},
		} as unknown as PluginContext;
		const buildEnd = plugin.buildEnd as (this: PluginContext, error: Error) => Promise<void>;
		await buildEnd.call(context, error);

		expect(resolveCalls).toBe(0);
		expectNoTrace(error);
	}, timeout);
});
