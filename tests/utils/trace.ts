import { expect } from 'manten';
import type { FsFixture } from 'fs-fixture';
import type { RollupErrorWithTrace } from '../../src/index.ts';

/**
 * Run a build that must fail, and return its error
 */
export const getBuildError = async (
	build: () => Promise<unknown>,
): Promise<RollupErrorWithTrace> => {
	try {
		await build();
	} catch (error) {
		return error as RollupErrorWithTrace;
	}
	throw new Error('Expected build to fail');
};

const slash = (filePath: string) => filePath.replaceAll('\\', '/');

/**
 * The import trace block the plugin appends to error messages
 */
export const formatTrace = (
	fixture: FsFixture,
	files: string[],
) => `\n\nImport trace:\n${files
	.map((file, index) => `    ${index === 0 ? '' : '↳ '}${slash(fixture.getPath(file))}`)
	.join('\n')}\n`;

/**
 * Assert the complete import trace, both as the `importTrace` property
 * and as the block appended to the error message
 */
export const expectTrace = (
	error: RollupErrorWithTrace,
	fixture: FsFixture,
	files: string[],
) => {
	expect(error.importTrace).toStrictEqual(files.map(file => slash(fixture.getPath(file))));
	expect(error.message).toContain(formatTrace(fixture, files));
};

/**
 * Assert that the plugin left the error untouched
 */
export const expectNoTrace = (error: RollupErrorWithTrace) => {
	expect(error.importTrace).toBeUndefined();
	expect(error.message).not.toContain('Import trace:');
};
