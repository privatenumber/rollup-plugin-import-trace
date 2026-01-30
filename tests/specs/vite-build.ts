import { testSuite, expect } from 'manten';
import { createFixture } from 'fs-fixture';
import { viteBuild } from '../utils/vite.js';
import { importTrace, type RollupErrorWithTrace } from '../../src/index.js';

/**
 * Vite build mode tests for rollup-plugin-import-trace
 *
 * Vite build uses Rollup under the hood, so errors are enhanced
 * the same way as pure Rollup builds.
 */
export default testSuite('Vite build', ({ test }) => {
	test('enhances build errors with import trace', async () => {
		await using fixture = await createFixture({
			'index.js': 'export { value } from "./a.js"',
			'a.js': 'export { value } from "./b.js"',
			'b.js': 'export { value } from "./c.js"',
			'c.js': 'export { value } from "./broken.js"',
			'broken.js': 'export const value = "unclosed string',
		});

		const result = await viteBuild(fixture.path, {
			plugins: [importTrace()],
		});

		expect(result.success).toBe(false);
		expect(result.errors).toHaveLength(1);

		const error = result.errors[0] as RollupErrorWithTrace;
		expect(error.importTrace).toBeDefined();
		expect(error.importTrace![0]).toContain('index.js');
		expect(error.importTrace!.at(-1)).toContain('broken.js');
	});

	test('traces errors through node_modules', async () => {
	/**
	 * Simulates error deep in node_modules using ESM modules.
	 * Uses .mjs extension to ensure Vite treats them as ESM.
	 */
		await using fixture = await createFixture({
			'index.js': `
				import { helper } from './node_modules/some-lib/index.mjs'
			`,
			'node_modules/some-lib': {
				'index.mjs': `
					export { helper } from './utils/helper.mjs'
				`,
				utils: {
					'helper.mjs': `
						import './broken.mjs'
						export const helper = () => {}
					`,
					'broken.mjs': `
						invalid syntax {{{
					`,
				},
			},
		});

		const result = await viteBuild(fixture.path, {
			plugins: [importTrace()],
		});

		expect(result.success).toBe(false);
		expect(result.errors).toHaveLength(1);

		const error = result.errors[0] as RollupErrorWithTrace;
		expect(error.importTrace).toBeDefined();
		expect(error.importTrace).toHaveLength(4);
		expect(error.importTrace![0]).toContain('index.js');
		expect(error.importTrace![1]).toMatch(/some-lib/);
		expect(error.importTrace![2]).toContain('helper.mjs');
		expect(error.importTrace![3]).toContain('broken.mjs');
	});
});
