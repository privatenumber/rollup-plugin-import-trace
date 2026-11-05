import { inspect } from 'node:util';
import { describe, test, expect } from 'manten';
import { patchErrorWithTrace } from '../../src/index.ts';

const createError = (importTrace?: unknown) => {
	const error = Object.assign(new Error('Original message'), { importTrace });

	// Start the stack at the test that called this helper
	Error.captureStackTrace(error, createError);
	return error;
};

const trace = '\n\nImport trace:\n    /a.js\n    ↳ /b.js\n';

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

	// console.error() and util.inspect() print the stack. V8 formats it once,
	// with the message at that time, so the header must be rewritten too.
	test('rewrites the stack header to the patched message', () => {
		const error = createError(['/a.js', '/b.js']);
		const originalStack = error.stack!;

		patchErrorWithTrace(error);

		const frames = originalStack.slice('Error: Original message'.length);
		expect(error.stack).toBe(`Error: Original message${trace}${frames}`);
		expect(inspect(error)).toContain(trace);
	});

	// Reading the stack after the message changed would format it with the
	// patched message, so the header would already contain the trace
	test('adds the trace once to a stack that was not formatted yet', () => {
		const error = Object.assign(new Error('Original message'), { importTrace: ['/a.js', '/b.js'] });

		patchErrorWithTrace(error);

		expect(error.stack!.split('Import trace:')).toHaveLength(2);
		expect(error.stack).toMatch(/^Error: Original message\n\nImport trace:\n/);
	});

	test('matches the header by name, not an earlier occurrence of the message', () => {
		const error = Object.assign(new Error('Error'), { importTrace: ['/a.js', '/b.js'] });

		patchErrorWithTrace(error);

		expect(error.stack).toMatch(/^Error: Error\n\nImport trace:\n/);
	});

	// A stack whose header is not the current message was changed by someone
	// else, so there is no safe place to insert the trace
	test('leaves a stack whose header does not match the message', () => {
		for (const stack of [
			'Error: Other message\n    at f (file.js:1:1)',
			'Error: Original message plus more\n    at f (file.js:1:1)',
		]) {
			const error = createError(['/a.js', '/b.js']);
			error.stack = stack;

			patchErrorWithTrace(error);

			expect(error.message).toContain('Import trace:');
			expect(error.stack).toBe(stack);
		}
	});

	test('patches the stack when the message is read-only', () => {
		const error = createError(['/a.js', '/b.js']);
		Object.defineProperty(error, 'message', {
			value: 'Original message',
			writable: false,
		});

		patchErrorWithTrace(error);

		expect(error.message).toBe('Original message');
		expect(error.stack).toMatch(/^Error: Original message\n\nImport trace:\n/);
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

	// A Proxy that forwards to a native error must keep its stack frames
	test('keeps the stack of a proxied error', () => {
		const error = new Proxy(createError(['/a.js', '/b.js']), {
			get: (target, key) => Reflect.get(target, key, target),
		});

		patchErrorWithTrace(error);

		expect(error.message).toContain('Import trace:');
		expect(error.stack).toMatch(/^Error: Original message\n[\s\S]*\n {4}at /);
	});

	test('keeps an error whose stack assignment is refused', () => {
		const error = new Proxy(createError(['/a.js', '/b.js']), {
			set: (target, key, value) => key !== 'stack' && Reflect.set(target, key, value),
		});

		expect(() => patchErrorWithTrace(error)).not.toThrow();
		expect(error.message).toContain('Import trace:');
	});

	// V8's stack setter still works on a frozen error, so only the message stays
	test('keeps a frozen error', () => {
		const error = Object.freeze(createError(['/a.js', '/b.js']));

		expect(() => patchErrorWithTrace(error)).not.toThrow();
		expect(error.message).toBe('Original message');
		expect(error.stack).toMatch(/^Error: Original message\n/);
	});

	test('keeps an error whose importTrace cannot be read', () => {
		const error = new Proxy(createError(['/a.js']), {
			has: () => {
				throw new Error('Refused');
			},
		});

		expect(() => patchErrorWithTrace(error)).not.toThrow();
	});

	test('is idempotent', () => {
		const error = createError(['/a.js', '/b.js']);

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
