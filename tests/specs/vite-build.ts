import { describe, test } from 'manten';
import { createFixture } from '../utils/fixture.ts';
import { getBuildError, expectTrace } from '../utils/trace.ts';
import { viteBuild } from '../utils/vite.ts';
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
});
