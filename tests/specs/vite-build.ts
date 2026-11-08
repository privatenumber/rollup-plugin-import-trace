import { describe, test } from 'manten';
import { createFixture } from 'fs-fixture';
import { getBuildError, expectTrace } from '../utils/trace.ts';
import { type Vite, createViteHelpers } from '../utils/vite.ts';
import { importTrace } from '../../src/index.ts';

export const viteBuildSpecs = (vite: Vite) => describe(`Vite ${vite.version.split('.', 1)[0]} build`, () => {
	const { viteBuild, viteServe } = createViteHelpers(vite);

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

	// Replaying the package import fails again with an error that names the
	// package entry, which recovers the edge into the package
	test('syntax error in a package entry', async () => {
		await using fixture = await createFixture({
			'index.js': 'export { value } from "./a.js"',
			'a.js': 'export { value } from "some-lib"',
			'node_modules/some-lib': {
				'package.json': JSON.stringify({
					name: 'some-lib',
					type: 'module',
					exports: './index.js',
				}),
				'index.js': 'export const value = "unclosed',
			},
		});

		const error = await getBuildError(() => viteBuild(fixture.path, {
			plugins: [importTrace()],
		}));

		expectTrace(error, fixture, ['index.js', 'a.js', 'node_modules/some-lib/index.js']);
	});

	// Replaying the ../ import fails again with an error that names broken.js,
	// which recovers the edge that matching the specifier's path could not
	test('syntax error reached through a ../ import in node_modules', async () => {
		await using fixture = await createFixture({
			'index.js': 'export { value } from "./a.js"',
			'a.js': 'export { value } from "some-lib"',
			'node_modules/some-lib': {
				'package.json': JSON.stringify({
					name: 'some-lib',
					type: 'module',
					exports: './src/index.js',
				}),
				'src/index.js': 'export { value } from "../broken.js"',
				'broken.js': 'export const value = "unclosed',
			},
		});

		const error = await getBuildError(() => viteBuild(fixture.path, {
			plugins: [importTrace()],
		}));

		expectTrace(error, fixture, [
			'index.js',
			'a.js',
			'node_modules/some-lib/src/index.js',
			'node_modules/some-lib/broken.js',
		]);
	});

	// Vite drops the edge into the package too. Replaying the package import
	// fails again with an error that names the package entry, which recovers it.
	test('syntax error in a CommonJS require chain', async () => {
		await using fixture = await createFixture({
			'index.js': 'import lib from "some-lib"; console.log(lib);',
			'node_modules/some-lib': {
				'package.json': JSON.stringify({
					name: 'some-lib',
					main: 'index.js',
				}),
				'index.js': 'module.exports = require("./broken.js");',
				'broken.js': 'module.exports = "unclosed',
			},
		});

		const error = await getBuildError(() => viteBuild(fixture.path, {
			plugins: [importTrace()],
		}));

		expectTrace(error, fixture, [
			'index.js',
			'node_modules/some-lib/index.js',
			'node_modules/some-lib/broken.js',
		]);
	});
});
