import path from 'node:path';
import { describe, test, expect } from 'manten';
import spawn from 'nano-spawn';
import { type FileTree, createFixture } from 'fs-fixture';
import { formatTrace } from '../utils/trace.ts';

/**
 * Tests the published entry points in dist/ (built by `pnpm test`),
 * resolved through package.json#exports like a consumer would.
 */
const projectRoot = path.resolve(import.meta.dirname, '../..');
const nodeModulesPath = path.join(projectRoot, 'node_modules');

const linkDependencies = (names: string[]): FileTree => {
	const links: FileTree = {
		'rollup-plugin-import-trace': ({ symlink }) => symlink(projectRoot),
	};
	for (const name of names) {
		links[name] = ({ symlink }) => symlink(path.join(nodeModulesPath, name));
	}
	return links;
};

describe('Package', () => {
	test('types', async () => {
		await using fixture = await createFixture({
			'tsconfig.json': JSON.stringify({
				compilerOptions: {
					strict: true,
					module: 'esnext',
					moduleResolution: 'bundler',
					target: 'esnext',
					noEmit: true,
					types: [],
				},
			}),
			'rollup.config.ts': `
				import { defineConfig, rollup } from 'rollup';
				import { importTrace, patchErrorWithTrace, type RollupErrorWithTrace } from 'rollup-plugin-import-trace';

				export default defineConfig({
					input: 'index.js',
					plugins: [importTrace()],
				});

				rollup({ plugins: [importTrace()] }).catch((error: RollupErrorWithTrace) => {
					const trace: string[] | undefined = error.importTrace;
					patchErrorWithTrace(error);
					return trace;
				});

				// Accepts unknown
				patchErrorWithTrace(null);
			`,
			'vite.config.ts': `
				import { defineConfig } from 'vite';
				import { importTrace } from 'rollup-plugin-import-trace';

				export default defineConfig({
					plugins: [importTrace()],
				});
			`,
			node_modules: linkDependencies(['rollup', 'vite']),
		});

		await spawn(path.join(nodeModulesPath, '.bin/tsc'), [], { cwd: fixture.path });
	});

	// node16 resolution picks types by condition: a value import in a .cts
	// file compiles to require, so it must get CommonJS declarations
	test('types for node16 ESM and CommonJS consumers', async () => {
		await using fixture = await createFixture({
			'tsconfig.json': JSON.stringify({
				compilerOptions: {
					strict: true,
					module: 'node16',
					target: 'esnext',
					noEmit: true,
					types: [],
				},
			}),
			'esm.mts': `
				import { importTrace, type RollupErrorWithTrace } from 'rollup-plugin-import-trace';
				importTrace();
				export type T = RollupErrorWithTrace;

				// ESM declarations have no default export. CommonJS declarations
				// would allow one, so this fails if import resolves the wrong file.
				// @ts-expect-error -- no default export
				import importTraceDefault from 'rollup-plugin-import-trace';
				export { importTraceDefault };
			`,
			'cjs.cts': `
				import { importTrace, type RollupErrorWithTrace } from 'rollup-plugin-import-trace';
				importTrace();
				export type T = RollupErrorWithTrace;
			`,
			node_modules: linkDependencies(['rollup']),
		});

		await spawn(path.join(nodeModulesPath, '.bin/tsc'), [], { cwd: fixture.path });
	});

	for (const [format, file, imports] of [
		['ESM', 'build.mjs', `
			import { inspect } from 'node:util';
			import { rollup } from 'rollup';
			import { importTrace } from 'rollup-plugin-import-trace';
		`],
		['CommonJS', 'build.cjs', `
			const { inspect } = require('node:util');
			const { rollup } = require('rollup');
			const { importTrace } = require('rollup-plugin-import-trace');
		`],
	]) {
		test(`${format} entry traces a build error`, async () => {
			await using fixture = await createFixture({
				'index.js': 'export { value } from "./broken.js"',
				'broken.js': 'invalid syntax {{{',
				[file]: `
					${imports}
					rollup({ input: 'index.js', plugins: [importTrace()] }).catch((error) => {
						console.log(JSON.stringify({
							importTrace: error.importTrace,
							// What console.error(error) prints
							inspected: inspect(error),
						}));
					});
				`,
				node_modules: linkDependencies(['rollup']),
			});

			const { stdout } = await spawn(process.execPath, [file], { cwd: fixture.path });
			const { importTrace, inspected } = JSON.parse(stdout);
			expect(importTrace).toStrictEqual([
				fixture.getPath('index.js'),
				fixture.getPath('broken.js'),
			].map(filePath => filePath.replaceAll('\\', '/')));
			expect(inspected).toContain(formatTrace(fixture, ['index.js', 'broken.js']));
		});
	}

	// Replay can wait on a resolver that never settles. The recovery deadline
	// must keep the process alive until it ends, or Rollup replaces the
	// original error with "Unexpected early exit". A test runner keeps its own
	// timers alive, so this runs in a separate process with nothing else.
	test('a resolver that never settles on replay keeps the original error', async () => {
		await using fixture = await createFixture({
			'index.js': 'import "pkg";',
			'build.mjs': `
				import { rollup } from 'rollup';
				import { importTrace } from 'rollup-plugin-import-trace';

				let calls = 0;
				rollup({
					input: 'index.js',
					plugins: [importTrace(), {
						name: 'hanging-resolver',
						resolveId(source) {
							if (source !== 'pkg') {
								return null;
							}
							calls += 1;
							if (calls === 1) {
								throw Object.assign(new Error('original'), { path: 'missing.js' });
							}
							return new Promise(() => {});
						},
					}],
				}).catch((error) => {
					console.log(error.message);
				});
			`,
			node_modules: linkDependencies(['rollup']),
		});

		const { stdout } = await spawn(process.execPath, ['build.mjs'], { cwd: fixture.path });
		expect(stdout).toBe('original');
	}, 15_000);
});
