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
});
