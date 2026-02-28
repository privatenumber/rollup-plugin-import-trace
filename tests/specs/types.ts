import path from 'node:path';
import { describe, test } from 'manten';
import { createFixture } from 'fs-fixture';
import spawn from 'nano-spawn';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const nodeModulesPath = path.join(projectRoot, 'node_modules');
const tscPath = path.join(nodeModulesPath, '.bin/tsc');

const tsc = (cwd: string) => spawn(tscPath, [], { cwd });

const baseTsConfig = {
	compilerOptions: {
		strict: true,
		moduleResolution: 'bundler',
		module: 'esnext',
		target: 'esnext',
		lib: ['esnext'],
		noEmit: true,
	},
};

describe('Types', () => {
	describe('Rollup', () => {
		test('plugin works with rollup()', async () => {
			await using fixture = await createFixture({
				'tsconfig.json': JSON.stringify(baseTsConfig),
				'rollup.config.ts': `
					import { rollup } from 'rollup';
					import { importTrace, patchErrorWithTrace, type RollupErrorWithTrace } from 'rollup-plugin-import-trace';

					// Plugin in rollup()
					rollup({
						input: 'index.js',
						plugins: [importTrace()],
					});

					// Type for caught errors
					const handleError = (error: RollupErrorWithTrace) => {
						const trace: string[] | undefined = error.importTrace;
						return trace;
					};

					// patchErrorWithTrace accepts unknown
					patchErrorWithTrace(new Error('test'));
					patchErrorWithTrace(null);
					patchErrorWithTrace(undefined);
				`,
				node_modules: {
					'rollup-plugin-import-trace': ({ symlink }) => symlink(projectRoot),
					rollup: ({ symlink }) => symlink(path.join(nodeModulesPath, 'rollup')),
				},
			});

			await tsc(fixture.path);
		});

		test('plugin works with defineConfig()', async () => {
			await using fixture = await createFixture({
				'tsconfig.json': JSON.stringify(baseTsConfig),
				'rollup.config.ts': `
					import { defineConfig } from 'rollup';
					import { importTrace } from 'rollup-plugin-import-trace';

					export default defineConfig({
						input: 'index.js',
						plugins: [importTrace()],
					});
				`,
				node_modules: {
					'rollup-plugin-import-trace': ({ symlink }) => symlink(projectRoot),
					rollup: ({ symlink }) => symlink(path.join(nodeModulesPath, 'rollup')),
				},
			});

			await tsc(fixture.path);
		});
	});

	describe('Vite', () => {
		test('plugin works with defineConfig()', async () => {
			await using fixture = await createFixture({
				'tsconfig.json': JSON.stringify(baseTsConfig),
				'vite.config.ts': `
					import { defineConfig } from 'vite';
					import { importTrace } from 'rollup-plugin-import-trace';

					export default defineConfig({
						plugins: [importTrace()],
					});
				`,
				node_modules: {
					'rollup-plugin-import-trace': ({ symlink }) => symlink(projectRoot),
					vite: ({ symlink }) => symlink(path.join(nodeModulesPath, 'vite')),
				},
			});

			await tsc(fixture.path);
		});
	});
});
