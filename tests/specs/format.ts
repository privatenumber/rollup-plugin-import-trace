import { describe, test, expect } from 'manten';
import { patchErrorWithTrace } from '../../src/index.ts';

const createError = (importTrace?: unknown) => Object.assign(
	new Error('Original message'),
	{ importTrace },
);

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
