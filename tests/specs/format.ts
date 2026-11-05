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

	test('is idempotent', () => {
		const error = createError(['/a.js', '/b.js']);

		patchErrorWithTrace(error);
		const patched = error.message;
		patchErrorWithTrace(error);

		expect(error.message).toBe(patched);
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
