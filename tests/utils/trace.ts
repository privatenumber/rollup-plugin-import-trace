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
	const error = new Error('Expected build to fail');

	// Start the stack at the test that called this helper
	Error.captureStackTrace(error, getBuildError);
	throw error;
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

	// Exactly one block, not followed by another trace entry. Vite appends
	// a file location and code frame after it.
	const trace = formatTrace(fixture, files);
	const traceIndex = error.message.indexOf(trace);
	expect(traceIndex).not.toBe(-1);
	expect(error.message.split('Import trace:')).toHaveLength(2);
	expect(error.message.slice(traceIndex + trace.length)).not.toMatch(/^ {4}/);
};

/**
 * Assert that the plugin attached no trace
 */
export const expectNoTrace = (error: RollupErrorWithTrace) => {
	expect(error.importTrace).toBeUndefined();
	expect(error.message).not.toContain('Import trace:');
};
