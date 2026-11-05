import { describe, test, expect } from 'manten';
import { createFixture } from '../utils/fixture.ts';
import { formatTrace } from '../utils/trace.ts';
import { viteServe } from '../utils/vite.ts';
import { importTrace } from '../../src/index.ts';

describe('Vite dev', () => {
	test('serves transformed modules', async () => {
		await using fixture = await createFixture({
			'index.js': 'import { value } from "./a.js"; console.log(value);',
			'a.js': 'export const value = "hello";',
		});
		await using dev = await viteServe(fixture.path, { plugins: [importTrace()] });

		const response = await fetch(`${dev.url}/index.js`);
		expect(response.status).toBe(200);

		// Vite rewrites relative imports, so a raw static response fails here
		expect(await response.text()).toContain('from "/a.js"');
	});

	test('syntax error', async () => {
		await using fixture = await createFixture({
			'index.js': 'import { value } from "./a.js"; console.log(value);',
			'a.js': 'import { value } from "./b.js"; export { value };',
			'b.js': 'import { value } from "./broken.js"; export { value };',
			'broken.js': 'export const value = "unclosed',
		});
		await using dev = await viteServe(fixture.path, { plugins: [importTrace()] });

		// Vite builds the module graph lazily, like a browser following imports
		for (const file of ['index.js', 'a.js', 'b.js']) {
			const response = await fetch(`${dev.url}/${file}`);
			expect(response.status).toBe(200);
		}

		const response = await fetch(`${dev.url}/broken.js`);
		expect(response.status).toBe(500);

		// Vite also logs a "Pre-transform error" when it pre-transforms b.js's
		// imports; only the request error goes through the error middleware
		const requestErrors = dev.errors.filter(message => message.startsWith('Internal server error'));
		expect(requestErrors).toHaveLength(1);
		expect(requestErrors[0]).toContain(
			formatTrace(fixture, ['index.js', 'a.js', 'b.js', 'broken.js']),
		);
	});

	test('no trace for a module without importers', async () => {
		await using fixture = await createFixture({
			'broken.js': 'export const value = "unclosed',
		});
		await using dev = await viteServe(fixture.path, { plugins: [importTrace()] });

		const response = await fetch(`${dev.url}/broken.js`);
		expect(response.status).toBe(500);
		expect(dev.errors).toHaveLength(1);
		expect(dev.errors[0]).toMatch(/^Internal server error/);
		expect(dev.errors[0]).not.toContain('Import trace:');
	});
});
