import { testSuite, expect } from 'manten';
import { patchErrorWithTrace } from '../../src/index.js';

type ErrorWithTrace = Error & { importTrace?: string[] };

export default testSuite('patchErrorWithTrace', ({ test }) => {
	test('appends trace to error message', ({ expectSnapshot }) => {
		const error = new Error('Original message') as ErrorWithTrace;
		error.importTrace = ['/path/to/entry.js', '/path/to/broken.js'];

		patchErrorWithTrace(error);

		expectSnapshot(error.message);
	});

	test('works with single entry trace', ({ expectSnapshot }) => {
		const error = new Error('Original message') as ErrorWithTrace;
		error.importTrace = ['/path/to/entry.js'];

		patchErrorWithTrace(error);

		expectSnapshot(error.message);
	});

	test('does nothing when no importTrace property', () => {
		const error = new Error('Original message');

		patchErrorWithTrace(error);

		expect(error.message).toBe('Original message');
	});

	test('does nothing for non-object values', () => {
		patchErrorWithTrace(null);
		patchErrorWithTrace(undefined);
		patchErrorWithTrace('string error');
		patchErrorWithTrace(123);
	});

	test('does nothing when importTrace is not an array', () => {
		const error: Error & { importTrace?: unknown } = new Error('Original message');
		error.importTrace = 'not an array';

		patchErrorWithTrace(error);

		expect(error.message).toBe('Original message');
	});

	test('formats trace with arrow prefix for nested imports', ({ expectSnapshot }) => {
		const error = new Error('Error') as ErrorWithTrace;
		error.importTrace = ['/a.js', '/b.js', '/c.js'];

		patchErrorWithTrace(error);

		expectSnapshot(error.message);
	});
});
