import { describe, test, expect } from 'manten';
import { patchErrorWithTrace } from '../../src/index.ts';

const createError = (importTrace?: unknown) => {
	const error = Object.assign(new Error('Original message'), { importTrace });

	// Start the stack at the test that called this helper
	Error.captureStackTrace(error, createError);
	return error;
};

describe('patchErrorWithTrace', () => {
	test('formats a single-entry trace', () => {
		const error = createError(['/a.js']);

		patchErrorWithTrace(error);

		expect(error.message).toBe('Original message\n\nImport trace:\n    /a.js\n');
	});

	test('appends the trace to the message', () => {
		const error = createError(['/a.js', '/b.js', '/c.js']);

		patchErrorWithTrace(error);

		expect(error.message).toBe([
			'Original message',
			'',
			'Import trace:',
			'    /a.js',
			'    ↳ /b.js',
			'    ↳ /c.js',
			'',
		].join('\n'));
	});

	// V8 formats error.stack on first access, so a stack read before patching
	// keeps the old message. console.error() and util.inspect() print the stack.
	test('updates a stack that was already formatted', () => {
		const error = createError(['/a.js', '/b.js']);
		const originalStack = error.stack!;

		patchErrorWithTrace(error);

		expect(error.stack).toBe(originalStack.replace('Original message', error.message));
	});

	// Reading the stack would make V8 format it with the message at that time
	test('leaves an unformatted stack to reflect later message changes', () => {
		const error = createError(['/a.js', '/b.js']);

		patchErrorWithTrace(error);
		error.message = `[plugin] ${error.message}`;

		expect(error.stack).toMatch(/^Error: \[plugin\] Original message\n\nImport trace:\n/);
	});

	test('adds the trace to a stack whose message changed after formatting', () => {
		for (const message of ['Original message', '']) {
			const error = createError(['/a.js', '/b.js']);
			const originalStack = error.stack!;
			error.message = message === '' ? '' : 'Changed message';

			patchErrorWithTrace(error);

			const framesIndex = originalStack.indexOf('\n    at ');
			const header = originalStack.slice(0, framesIndex);
			const frames = originalStack.slice(framesIndex);
			expect(error.stack).toBe(`${header}\n\nImport trace:\n    /a.js\n    ↳ /b.js\n${frames}`);
		}
	});

	test('inserts the trace after the message, not after a matching error name', () => {
		const error = Object.assign(new Error('Error'), { importTrace: ['/a.js', '/b.js'] });
		expect(error.stack).toMatch(/^Error: Error\n/);

		patchErrorWithTrace(error);

		expect(error.stack).toMatch(/^Error: Error\n\nImport trace:\n/);
	});

	test('repairs the stack when the message already has the trace', () => {
		const error = createError(['/a.js', '/b.js']);
		expect(error.stack).toContain('Original message');
		error.message += '\n\nImport trace:\n    /a.js\n    ↳ /b.js\n';

		patchErrorWithTrace(error);

		expect(error.stack).toContain('\n\nImport trace:\n    /a.js\n    ↳ /b.js\n');
	});

	test('keeps an error whose stack cannot be changed', () => {
		const error = createError(['/a.js', '/b.js']);
		Object.defineProperty(error, 'stack', {
			value: 'Error: Original message\n    at f (file.js:1:1)',
			writable: false,
			configurable: false,
		});

		expect(() => patchErrorWithTrace(error)).not.toThrow();
		expect(error.message).toContain('Import trace:');
		expect(error.stack).toBe('Error: Original message\n    at f (file.js:1:1)');
	});

	test('is idempotent', () => {
		const error = createError(['/a.js', '/b.js']);

		// Format the stack before patching
		expect(error.stack).toContain('Original message');
		patchErrorWithTrace(error);
		const { message, stack } = error;
		patchErrorWithTrace(error);

		expect(error.message).toBe(message);
		expect(error.stack).toBe(stack);
	});

	test('ignores errors without an importTrace array', () => {
		for (const importTrace of [undefined, 'not an array']) {
			const error = createError(importTrace);

			patchErrorWithTrace(error);

			expect(error.message).toBe('Original message');
		}
	});

	test('accepts non-error values', () => {
		for (const value of [null, undefined, 'string error', 123]) {
			expect(() => patchErrorWithTrace(value)).not.toThrow();
		}
	});
});
