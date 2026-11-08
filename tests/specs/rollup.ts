import { describe, test, expect } from 'manten';
import type * as rollup4 from 'rollup';
import type { Plugin } from 'rollup';
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { createFixture } from 'fs-fixture';
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

/**
 * The parts of a Rollup version's API the tests use. Rollup 3 is installed
 * under an alias (rollup3) and cast to this type.
 */
export type Rollup = Pick<typeof rollup4, 'rollup' | 'VERSION'>;

export const rollupSpecs = ({ rollup, VERSION }: Rollup) => describe(`Rollup ${VERSION.split('.', 1)[0]}`, () => {
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

		// The error's id is the requiring module, and loc.file is the required
		// file that failed to parse
		test('CommonJS require of a broken file', async () => {
			await using fixture = await createFixture({
				'index.js': 'import lib from "lib"; console.log(lib);',
				'node_modules/lib': {
					'package.json': JSON.stringify({
						name: 'lib',
						main: 'index.js',
					}),
					'index.js': 'module.exports = require("./broken.js");',
					'broken.js': 'module.exports = "unclosed',
				},
			});

			const error = await getBuildError(() => rollup({
				input: fixture.getPath('index.js'),
				plugins: [importTrace(), nodeResolve(), commonjs()],
			}));

			expectTrace(error, fixture, [
				'index.js',
				'node_modules/lib/index.js',
				'node_modules/lib/broken.js',
			]);
		});

		// Rollup uses backslash module IDs on Windows. Virtual modules with
		// backslash IDs exercise the same normalization on every OS.
		test('module IDs with backslashes', async () => {
			const files: Record<string, string> = {
				'C:\\project\\index.js': 'export { value } from "./a.js"',
				'C:\\project\\a.js': 'export { value } from "./broken.js"',
				'C:\\project\\broken.js': 'invalid syntax {{{',
			};

			const error = await getBuildError(() => rollup({
				input: String.raw`C:\project\index.js`,
				plugins: [
					importTrace(),
					{
						name: 'virtual-windows-paths',
						resolveId: (source, importer) => (
							importer
								? `C:\\project\\${source.slice(2)}`
								: source
						),
						load: id => files[id],
					},
				],
			}));

			expect(error.importTrace).toStrictEqual([
				'C:/project/index.js',
				'C:/project/a.js',
				'C:/project/broken.js',
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
	});

	// @rollup/plugin-commonjs resolves modules again by absolute path, which
	// can be the only record of an edge. A Windows path has no forward slash,
	// so it must be matched as a path, not as a package subpath. The drive
	// letter path reproduces this on every OS.
	test('recovers an edge recorded with an absolute path', async () => {
		const brokenId = String.raw`C:\project\broken.js`;
		const files: Record<string, string> = {
			[String.raw`C:\project\index.js`]: 'export { value } from "./a.js"',
			[String.raw`C:\project\a.js`]: `export { value } from ${JSON.stringify(brokenId)}`,
		};

		const error = await getBuildError(() => rollup({
			input: String.raw`C:\project\index.js`,
			plugins: [
				importTrace(),
				{
					name: 'virtual-windows-paths',
					resolveId: (source) => {
						if (source === brokenId) {
							throw Object.assign(new Error('ENOENT'), { path: brokenId });
						}
						return source.startsWith('./') ? `C:\\project\\${source.slice(2)}` : source;
					},
					load: id => files[id],
				},
			],
		}));

		expect(error.importTrace).toStrictEqual([
			'C:/project/index.js',
			'C:/project/a.js',
			'C:/project/broken.js',
		]);
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

	describe('errors that refuse changes', () => {
		// A Proxy that throws on a read must not replace the original error
		test('original error survives a throwing property read', async () => {
			await using fixture = await createFixture({
				'index.js': 'export { value } from "./a.js"',
				'a.js': 'export const value = 1',
			});
			const original = new Error('Original failure');

			const error = await getBuildError(() => rollup({
				input: fixture.getPath('index.js'),
				plugins: [
					importTrace(),
					{
						name: 'throw-proxy',
						transform: (_code, id) => {
							if (id.endsWith('a.js')) {
								throw new Proxy(original, {
									get: (target, key) => {
										if (key === 'id') {
											throw new Error('Refused');
										}
										return Reflect.get(target, key, target);
									},
								});
							}
						},
					},
				],
			}));

			expect(error.message).toContain('Original failure');
			expect(error.message).not.toContain('Refused');
		});

		// A setter can accept importTrace without storing it
		test('no stale trace when importTrace is not stored', async () => {
			await using fixture = await createFixture({
				'index.js': 'export { value } from "./a.js"',
				'a.js': 'export const value = 1',
			});

			const error = await getBuildError(() => rollup({
				input: fixture.getPath('index.js'),
				plugins: [
					importTrace(),
					{
						name: 'stale-trace',
						transform: (_code, id) => {
							if (id.endsWith('a.js')) {
								throw Object.defineProperty(new Error('Original failure'), 'importTrace', {
									get: () => ['/unrelated.js'],
									set: () => {},
								});
							}
						},
					},
				],
			}));

			expect(error.message).not.toContain('/unrelated.js');
		});
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
				'x.js': 'export const value = 1',
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
							if (id === fixture2.getPath('x.js')) {
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
