import { describe, test } from 'manten';
import { rollup, type Plugin } from 'rollup';
import nodeResolve from '@rollup/plugin-node-resolve';
import { createFixture } from '../utils/fixture.ts';
import { getBuildError, expectTrace, expectNoTrace } from '../utils/trace.ts';
import { importTrace } from '../../src/index.ts';

// Simulates a resolver that crashes while probing the file system, such as
// commonjs--resolver hitting ENOENT. Rollup records no import edge for a
// specifier whose resolveId throws.
const throwingResolver = (
	specifier: string,
	errorPath: string,
): Plugin => ({
	name: 'throwing-resolver',
	resolveId: (source) => {
		if (source === specifier) {
			throw Object.assign(new Error(`ENOENT: open '${errorPath}'`), { path: errorPath });
		}
		return null;
	},
});

describe('Rollup', () => {
	describe('build phase', () => {
		test('syntax error', async () => {
			await using fixture = await createFixture({
				'index.js': 'export { value } from "./a.js"',
				'a.js': 'export { value } from "./broken.js"',
				'broken.js': 'this is not valid javascript {{{',
			});

			const error = await getBuildError(() => rollup({
				input: fixture.getPath('index.js'),
				plugins: [importTrace()],
			}));

			expectTrace(error, fixture, ['index.js', 'a.js', 'broken.js']);
		});

		test('unresolved import is traced to the importing module', async () => {
			await using fixture = await createFixture({
				'index.js': 'export { value } from "./a.js"',
				'a.js': 'export { value } from "./missing.js"',
			});

			const error = await getBuildError(() => rollup({
				input: fixture.getPath('index.js'),
				plugins: [importTrace()],
			}));

			expectTrace(error, fixture, ['index.js', 'a.js']);
		});

		test('no trace when the entry point fails', async () => {
			await using fixture = await createFixture({
				'index.js': 'this is not valid javascript {{{',
			});

			const error = await getBuildError(() => rollup({
				input: fixture.getPath('index.js'),
				plugins: [importTrace()],
			}));

			expectNoTrace(error);
		});

		test('no trace when the error has no file', async () => {
			await using fixture = await createFixture({
				'index.js': 'export const value = 1',
			});

			const error = await getBuildError(() => rollup({
				input: fixture.getPath('index.js'),
				plugins: [
					importTrace(),
					{
						name: 'fail',
						buildStart: () => {
							throw new Error('fail');
						},
					},
				],
			}));

			expectNoTrace(error);
		});

		test('circular imports', async () => {
			await using fixture = await createFixture({
				'index.js': 'export { a } from "./a.js"',
				'a.js': 'export { b } from "./b.js"; export const a = "a";',
				'b.js': 'export { a } from "./a.js"; export { broken } from "./broken.js";',
				'broken.js': 'invalid syntax {{{',
			});

			const error = await getBuildError(() => rollup({
				input: fixture.getPath('index.js'),
				plugins: [importTrace()],
			}));

			expectTrace(error, fixture, ['index.js', 'a.js', 'b.js', 'broken.js']);
		});

		test('dynamic import', async () => {
			await using fixture = await createFixture({
				'index.js': 'import("./a.js")',
				'a.js': 'export { value } from "./broken.js"',
				'broken.js': 'invalid syntax {{{',
			});

			const error = await getBuildError(() => rollup({
				input: fixture.getPath('index.js'),
				plugins: [importTrace()],
			}));

			expectTrace(error, fixture, ['index.js', 'a.js', 'broken.js']);
		});

		test('through node_modules', async () => {
			await using fixture = await createFixture({
				'index.js': 'import { value } from "some-lib"',
				'node_modules/some-lib': {
					'package.json': JSON.stringify({
						name: 'some-lib',
						main: 'index.js',
					}),
					'index.js': 'export { value } from "./broken.js"',
					'broken.js': 'invalid syntax {{{',
				},
			});

			const error = await getBuildError(() => rollup({
				input: fixture.getPath('index.js'),
				plugins: [nodeResolve(), importTrace()],
			}));

			expectTrace(error, fixture, [
				'index.js',
				'node_modules/some-lib/index.js',
				'node_modules/some-lib/broken.js',
			]);
		});

		// Load errors such as ENOENT have `path` but no `id` or `loc.file`
		test('load error located by error.path', async () => {
			await using fixture = await createFixture({
				'index.js': 'export { value } from "./a.js"',
				'a.js': 'export { value } from "./missing.js"',
			});

			const error = await getBuildError(() => rollup({
				input: fixture.getPath('index.js'),
				plugins: [
					{
						name: 'resolve-to-missing-file',
						resolveId: source => (
							source === './missing.js'
								? fixture.getPath('does-not-exist.js')
								: null
						),
					},
					importTrace(),
				],
			}));

			expectTrace(error, fixture, ['index.js', 'a.js', 'does-not-exist.js']);
		});
	});

	/**
	 * When a resolveId hook throws, Rollup records no import edge, so the
	 * module graph cannot reach the failing module. The plugin replays the
	 * resolveId calls it recorded to recover the importer.
	 */
	describe('recovering edges dropped by a throwing resolveId', () => {
		test('re-resolving succeeds', async () => {
			await using fixture = await createFixture({
				'index.js': 'export { value } from "./a.js"',
				'a.js': 'export { value } from "pkg"',
			});
			const modulePath = fixture.getPath('node_modules/pkg/index.js');

			// Throws on the first call only, so the replay resolves it
			let calls = 0;
			const error = await getBuildError(() => rollup({
				input: fixture.getPath('index.js'),
				plugins: [
					importTrace(),
					{
						name: 'flaky-resolver',
						resolveId: (source) => {
							if (source !== 'pkg') {
								return null;
							}
							calls += 1;
							if (calls === 1) {
								throw Object.assign(new Error('ENOENT'), { path: modulePath });
							}
							return modulePath;
						},
					},
				],
			}));

			expectTrace(error, fixture, ['index.js', 'a.js', 'node_modules/pkg/index.js']);
		});

		// Re-resolving throws again, so the specifier's subpath is matched against the error path
		for (const [specifier, errorFile] of [
			['./deep/module.js', 'deep/module.js'],
			['pkg/deep/module.js', 'node_modules/pkg/deep/module.js'],
			['@scope/pkg/deep/module.js', 'node_modules/@scope/pkg/deep/module.js'],
		]) {
			test(`subpath fallback for ${specifier}`, async () => {
				await using fixture = await createFixture({
					'index.js': 'export { value } from "./a.js"',
					'a.js': `export { value } from "${specifier}"`,
				});

				const error = await getBuildError(() => rollup({
					input: fixture.getPath('index.js'),
					plugins: [
						importTrace(),
						throwingResolver(specifier, fixture.getPath(errorFile)),
					],
				}));

				expectTrace(error, fixture, ['index.js', 'a.js', errorFile]);
			});
		}

		// A ../ specifier has no subpath that can identify the error path
		test('no trace for ../ specifiers', async () => {
			await using fixture = await createFixture({
				'src/index.js': 'export { value } from "./a.js"',
				'src/a.js': 'export { value } from "../deep/module.js"',
			});

			const error = await getBuildError(() => rollup({
				input: fixture.getPath('src/index.js'),
				plugins: [
					importTrace(),
					throwingResolver('../deep/module.js', fixture.getPath('deep/module.js')),
				],
			}));

			expectNoTrace(error);
		});
	});

	/**
	 * Some errors fire during output generation (chunk rendering), which
	 * buildEnd never sees. They may only carry `exporter` or `loc.file`.
	 */
	describe('output phase', () => {
		for (const [property, createLocation] of [
			['exporter', (file: string) => ({ exporter: file })],
			['loc.file', (file: string) => ({
				loc: {
					file,
					line: 1,
					column: 0,
				},
			})],
		] as const) {
			test(`error located by ${property}`, async () => {
				await using fixture = await createFixture({
					'index.js': 'export { value } from "./a.js"',
					'a.js': 'export { value } from "./b.js"',
					'b.js': 'export const value = 1',
				});

				const error = await getBuildError(async () => {
					const bundle = await rollup({
						input: fixture.getPath('index.js'),
						plugins: [
							importTrace(),
							{
								name: 'output-error',
								renderChunk() {
									// eslint-disable-next-line unicorn/no-this-outside-of-class -- Rollup passes the plugin context as `this` (https://github.com/pvtnbr/lintroll/issues/48)
									this.error({
										message: 'Output error',
										...createLocation(fixture.getPath('b.js')),
									});
								},
							},
						],
					});
					await bundle.generate({ format: 'es' });
				});

				expectTrace(error, fixture, ['index.js', 'a.js', 'b.js']);
			});
		}
	});

	describe('plugin instance reuse', () => {
		/**
		 * The plugin keeps resolveId records between hooks. A record left over
		 * from a previous build must not attach that build's importer to an
		 * unrelated error in the next build.
		 */
		test('records from a previous build are not replayed', async () => {
			const plugin = importTrace();
			await using fixture1 = await createFixture({
				'index.js': 'export { value } from "./a.js"',
				'a.js': 'export { value } from "pkg/deep/module.js"',
			});
			await using fixture2 = await createFixture({
				'index.js': 'export { value } from "./x.js"',
			});
			const throwing = throwingResolver(
				'pkg/deep/module.js',
				fixture1.getPath('node_modules/pkg/deep/module.js'),
			);

			const error1 = await getBuildError(() => rollup({
				input: fixture1.getPath('index.js'),
				plugins: [plugin, throwing],
			}));
			expectTrace(error1, fixture1, ['index.js', 'a.js', 'node_modules/pkg/deep/module.js']);

			// The second build fails on a path that build 1's record would match
			const error2 = await getBuildError(() => rollup({
				input: fixture2.getPath('index.js'),
				plugins: [
					plugin,
					throwing,
					{
						name: 'fail-load',
						load: (id) => {
							if (id.endsWith('x.js')) {
								throw Object.assign(new Error('ENOENT'), {
									path: fixture2.getPath('node_modules/pkg/deep/module.js'),
								});
							}
							return null;
						},
					},
				],
			}));
			expectNoTrace(error2);
		});
	});
});
