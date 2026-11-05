import path from 'node:path';
import { describe, test, expect } from 'manten';
import spawn from 'nano-spawn';
import type { FileTree } from 'fs-fixture';
import { createFixture } from '../utils/fixture.ts';

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

	// node16 resolution picks types by condition: a static import in a .cts
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
			import { rollup } from 'rollup';
			import { importTrace } from 'rollup-plugin-import-trace';
		`],
		['CommonJS', 'build.cjs', `
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
						console.log(JSON.stringify(error.importTrace));
					});
				`,
				node_modules: linkDependencies(['rollup']),
			});

			const { stdout } = await spawn(process.execPath, [file], { cwd: fixture.path });
			expect(JSON.parse(stdout)).toStrictEqual([
				fixture.getPath('index.js'),
				fixture.getPath('broken.js'),
			].map(filePath => filePath.replaceAll('\\', '/')));
		});
	}
});
