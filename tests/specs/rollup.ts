import { testSuite, expect } from 'manten';
import { rollup } from 'rollup';
import { createFixture } from 'fs-fixture';
import { setTimeout } from 'node:timers/promises';
import nodeResolve from '@rollup/plugin-node-resolve';
import { importTrace, type RollupErrorWithTrace } from '../../src/index.js';

/**
 * Rollup tests for rollup-plugin-import-trace
 *
 * Tests verify that build errors are automatically enhanced
 * with import traces showing how the problematic module was reached.
 */
export default testSuite('Rollup', ({ describe }) => {
	describe('Error enhancement', ({ test }) => {
		test('enhances syntax errors with import trace', async () => {
			await using fixture = await createFixture({
				'index.js': 'export { value } from "./a.js"',
				'a.js': 'export { value } from "./broken.js"',
				'broken.js': 'this is not valid javascript {{{',
			});

			let caughtError: RollupErrorWithTrace | undefined;
			try {
				await rollup({
					input: fixture.getPath('index.js'),
					plugins: [importTrace()],
				});
			} catch (error) {
				caughtError = error as RollupErrorWithTrace;
			}

			expect(caughtError).toBeDefined();
			expect(caughtError!.importTrace).toBeDefined();
			expect(caughtError!.importTrace).toHaveLength(3);
			expect(caughtError!.importTrace![0]).toContain('index.js');
			expect(caughtError!.importTrace![1]).toContain('a.js');
			expect(caughtError!.importTrace![2]).toContain('broken.js');
		});

		test('enhances resolution errors with import trace', async () => {
			await using fixture = await createFixture({
				'index.js': 'export { value } from "./a.js"',
				'a.js': 'export { value } from "./missing.js"',
			});

			let caughtError: RollupErrorWithTrace | undefined;
			try {
				await rollup({
					input: fixture.getPath('index.js'),
					plugins: [importTrace()],
				});
			} catch (error) {
				caughtError = error as RollupErrorWithTrace;
			}

			expect(caughtError).toBeDefined();
			expect(caughtError!.importTrace).toBeDefined();
			expect(caughtError!.importTrace).toHaveLength(2);
			expect(caughtError!.importTrace![0]).toContain('index.js');
			expect(caughtError!.importTrace![1]).toContain('a.js');
		});

		test('shows complete trace for deep errors', async () => {
			await using fixture = await createFixture({
				'index.js': 'export { value } from "./a.js"',
				'a.js': 'export { value } from "./b.js"',
				'b.js': 'export { value } from "./c.js"',
				'c.js': 'export { value } from "./broken.js"',
				'broken.js': 'export const value = "unclosed string',
			});

			let caughtError: RollupErrorWithTrace | undefined;
			try {
				await rollup({
					input: fixture.getPath('index.js'),
					plugins: [importTrace()],
				});
			} catch (error) {
				caughtError = error as RollupErrorWithTrace;
			}

			expect(caughtError).toBeDefined();
			// Full chain: index → a → b → c → broken
			expect(caughtError!.importTrace).toBeDefined();
			expect(caughtError!.importTrace).toHaveLength(5);
			expect(caughtError!.importTrace![0]).toContain('index.js');
			expect(caughtError!.importTrace![1]).toContain('a.js');
			expect(caughtError!.importTrace![2]).toContain('b.js');
			expect(caughtError!.importTrace![3]).toContain('c.js');
			expect(caughtError!.importTrace![4]).toContain('broken.js');
		});

		test('no trace when entry point has error', async () => {
			await using fixture = await createFixture({
				'index.js': 'this is not valid javascript {{{',
			});

			let caughtError: RollupErrorWithTrace | undefined;
			try {
				await rollup({
					input: fixture.getPath('index.js'),
					plugins: [importTrace()],
				});
			} catch (error) {
				caughtError = error as RollupErrorWithTrace;
			}

			expect(caughtError).toBeDefined();
			// No trace - entry point has no importers
			expect(caughtError!.importTrace).toBeUndefined();
		});

		test('handles circular dependencies without infinite loop', async () => {
			/**
			 * Circular dependencies should not cause infinite loops.
			 * The "first wins" logic prevents cycles in the importer map.
			 */
			await using fixture = await createFixture({
				'index.js': 'export { a } from "./a.js"',
				'a.js': 'export { b } from "./b.js"; export const a = "a";',
				'b.js': 'export { a } from "./a.js"; export { broken } from "./broken.js";',
				'broken.js': 'invalid syntax {{{',
			});

			let caughtError: RollupErrorWithTrace | undefined;
			try {
				await rollup({
					input: fixture.getPath('index.js'),
					plugins: [importTrace()],
				});
			} catch (error) {
				caughtError = error as RollupErrorWithTrace;
			}

			expect(caughtError).toBeDefined();
			// Should complete without hanging
			expect(caughtError!.importTrace).toBeDefined();
		});

		test('traces errors through node_modules', async () => {
			/**
			 * Main use case: error occurs deep in node_modules.
			 * Trace shows how your code led to the problematic dependency.
			 */
			await using fixture = await createFixture({
				'src/index.js': 'import { Button } from "some-lib"',
				'node_modules/some-lib': {
					'package.json': JSON.stringify({
						name: 'some-lib',
						main: 'dist/index.js',
					}),
					dist: {
						'index.js': `
							export { Button } from './components/Button.js'
						`,
						components: {
							'Button.js': `
								import './Button.css'
								export const Button = () => {}
							`,
							'Button.css': `
								.button { color: red; }
							`,
						},
					},
				},
			});

			let caughtError: RollupErrorWithTrace | undefined;
			try {
				await rollup({
					input: fixture.getPath('src/index.js'),
					plugins: [nodeResolve(), importTrace()],
				});
			} catch (error) {
				caughtError = error as RollupErrorWithTrace;
			}

			expect(caughtError).toBeDefined();
			// Full chain from src to node_modules
			expect(caughtError!.importTrace).toBeDefined();
			expect(caughtError!.importTrace).toHaveLength(4);
			expect(caughtError!.importTrace![0]).toContain('index.js');
			expect(caughtError!.importTrace![1]).toMatch(/some-lib/);
			expect(caughtError!.importTrace![2]).toContain('Button.js');
			expect(caughtError!.importTrace![3]).toContain('Button.css');
		});

		test('embeds formatted trace in error message', async () => {
			await using fixture = await createFixture({
				'index.js': 'export { value } from "./a.js"',
				'a.js': 'export { value } from "./broken.js"',
				'broken.js': 'this is not valid javascript {{{',
			});

			let caughtError: RollupErrorWithTrace | undefined;
			try {
				await rollup({
					input: fixture.getPath('index.js'),
					plugins: [importTrace()],
				});
			} catch (error) {
				caughtError = error as RollupErrorWithTrace;
			}

			expect(caughtError).toBeDefined();
			expect(caughtError!.message).toContain('Import trace:');
			expect(caughtError!.message).toContain('index.js');
			expect(caughtError!.message).toContain('broken.js');
		});

		/**
		 * When a module has a slow-resolving sibling import, moduleParsed
		 * for the parent is delayed (it waits for ALL imports to resolve).
		 * Meanwhile, a fast-resolving import can fail during parse, terminating
		 * the build before moduleParsed fires. The plugin falls back to
		 * getModuleInfo() in buildEnd to recover the import relationship.
		 */
		test('traces errors when sibling import delays moduleParsed', async () => {
			await using fixture = await createFixture({
				'index.js': 'export { a } from "./a.js"',
				'a.js': `export { value } from "./broken.js"\nimport "./slow.js"`,
				'slow.js': 'export const slow = 1',
				'broken.js': 'invalid syntax {{{',
			});

			let caughtError: RollupErrorWithTrace | undefined;
			try {
				await rollup({
					input: fixture.getPath('index.js'),
					plugins: [
						{
							name: 'slow-resolve',
							async resolveId(source) {
								if (source.includes('slow')) {
									await setTimeout(500);
								}
								return null;
							},
						},
						importTrace(),
					],
				});
			} catch (error) {
				caughtError = error as RollupErrorWithTrace;
			}

			expect(caughtError).toBeDefined();
			expect(caughtError!.importTrace).toBeDefined();
			// Full chain: index → a → broken
			expect(caughtError!.importTrace).toHaveLength(3);
			expect(caughtError!.importTrace![0]).toContain('index.js');
			expect(caughtError!.importTrace![1]).toContain('a.js');
			expect(caughtError!.importTrace![2]).toContain('broken.js');
		});

		/**
		 * Some errors (e.g. MISSING_EXPORT) fire during output generation
		 * (chunk.generateExports), not during the build phase. buildEnd
		 * never sees these. The renderError hook handles them.
		 *
		 * The error may only have `exporter` (not `id` or `loc.file`),
		 * so getErrorFile must check that property too.
		 */
		test('traces errors during output generation via renderError', async () => {
			await using fixture = await createFixture({
				'index.js': 'export { value } from "./a.js"',
				'a.js': 'export { value } from "./b.js"',
				'b.js': 'export const value = 1',
			});

			let caughtError: RollupErrorWithTrace | undefined;
			try {
				const build = await rollup({
					input: fixture.getPath('index.js'),
					plugins: [
						importTrace(),
						{
							name: 'test-output-error',
							renderChunk() {
								this.error({
									message: `Exported variable "x" is not defined in "${fixture.getPath('b.js')}".`,
									exporter: fixture.getPath('b.js'),
								} as Parameters<typeof this.error>[0]);
							},
						},
					],
				});

				await build.generate({ format: 'es' });
			} catch (error) {
				caughtError = error as RollupErrorWithTrace;
			}

			expect(caughtError).toBeDefined();
			expect(caughtError!.importTrace).toBeDefined();
			expect(caughtError!.importTrace).toHaveLength(3);
			expect(caughtError!.importTrace![0]).toContain('index.js');
			expect(caughtError!.importTrace![1]).toContain('a.js');
			expect(caughtError!.importTrace![2]).toContain('b.js');
			expect(caughtError!.message).toContain('Import trace:');
		});
	});

	describe('Plugin reusability', ({ test }) => {
		test('plugin instance can be reused across builds', async () => {
			const plugin = importTrace();

			// Build 1 - syntax error
			await using fixture1 = await createFixture({
				'index.js': 'export { value } from "./a.js"',
				'a.js': 'export { value } from "./broken.js"',
				'broken.js': 'this is not valid javascript {{{',
			});
			let error1: RollupErrorWithTrace | undefined;
			try {
				await rollup({
					input: fixture1.getPath('index.js'),
					plugins: [plugin],
				});
			} catch (error) {
				error1 = error as RollupErrorWithTrace;
			}
			expect(error1!.importTrace).toBeDefined();

			// Build 2 - deeper error (state should be cleared)
			await using fixture2 = await createFixture({
				'index.js': 'export { value } from "./a.js"',
				'a.js': 'export { value } from "./b.js"',
				'b.js': 'export { value } from "./c.js"',
				'c.js': 'export { value } from "./broken.js"',
				'broken.js': 'export const value = "unclosed string',
			});
			let error2: RollupErrorWithTrace | undefined;
			try {
				await rollup({
					input: fixture2.getPath('index.js'),
					plugins: [plugin],
				});
			} catch (error) {
				error2 = error as RollupErrorWithTrace;
			}
			// Should show new trace, not stale data from build 1
			expect(error2!.importTrace!.some(p => p.includes('c.js'))).toBe(true);
		});
	});
});
