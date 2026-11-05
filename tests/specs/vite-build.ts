import { describe, test } from 'manten';
import { createFixture } from '../utils/fixture.ts';
import { getBuildError, expectTrace } from '../utils/trace.ts';
import { viteBuild, viteServe } from '../utils/vite.ts';
import { importTrace } from '../../src/index.ts';

describe('Vite build', () => {
	test('syntax error', async () => {
		await using fixture = await createFixture({
			'index.js': 'export { value } from "./a.js"',
			'a.js': 'export { value } from "./b.js"',
			'b.js': 'export { value } from "./broken.js"',
			'broken.js': 'export const value = "unclosed string',
		});

		const error = await getBuildError(() => viteBuild(fixture.path, {
			plugins: [importTrace()],
		}));

		expectTrace(error, fixture, ['index.js', 'a.js', 'b.js', 'broken.js']);
	});

	test('syntax error in an ESM file under node_modules', async () => {
		await using fixture = await createFixture({
			'index.js': 'import { helper } from "./node_modules/some-lib/index.mjs"',
			'node_modules/some-lib': {
				'index.mjs': 'export { helper } from "./utils/helper.mjs"',
				utils: {
					'helper.mjs': 'import "./broken.mjs"; export const helper = () => {};',
					'broken.mjs': 'invalid syntax {{{',
				},
			},
		});

		const error = await getBuildError(() => viteBuild(fixture.path, {
			plugins: [importTrace()],
		}));

		expectTrace(error, fixture, [
			'index.js',
			'node_modules/some-lib/index.mjs',
			'node_modules/some-lib/utils/helper.mjs',
			'node_modules/some-lib/utils/broken.mjs',
		]);
	});

	// commonjs--resolver loads node_modules files from its resolveId hook,
	// so their syntax errors throw before Rollup records the import edge
	test('syntax error in node_modules', async () => {
		await using fixture = await createFixture({
			'index.js': 'export { value } from "./a.js"',
			'a.js': 'export { value } from "some-lib"',
			'node_modules/some-lib': {
				'package.json': JSON.stringify({
					name: 'some-lib',
					type: 'module',
					exports: './index.js',
				}),
				'index.js': 'export { value } from "./broken.js"',
				'broken.js': 'export const value = "unclosed string',
			},
		});

		const error = await getBuildError(() => viteBuild(fixture.path, {
			plugins: [importTrace()],
		}));

		expectTrace(error, fixture, [
			'index.js',
			'a.js',
			'node_modules/some-lib/index.js',
			'node_modules/some-lib/broken.js',
		]);
	});

	// The plugin stops recording resolveId calls in a dev server, and must
	// record again in a later build that reuses the same instance
	test('plugin instance reused after a dev server', async () => {
		await using fixture = await createFixture({
			'index.js': 'export { value } from "./a.js"',
			'a.js': 'export { value } from "some-lib"',
			'node_modules/some-lib': {
				'package.json': JSON.stringify({
					name: 'some-lib',
					type: 'module',
					exports: './index.js',
				}),
				'index.js': 'export { value } from "./broken.js"',
				'broken.js': 'export const value = "unclosed string',
			},
		});
		const plugin = importTrace();

		{
			await using _dev = await viteServe(fixture.path, { plugins: [plugin] });
		}

		const error = await getBuildError(() => viteBuild(fixture.path, {
			plugins: [plugin],
		}));

		expectTrace(error, fixture, [
			'index.js',
			'a.js',
			'node_modules/some-lib/index.js',
			'node_modules/some-lib/broken.js',
		]);
	});
});
