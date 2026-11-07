import type { RollupError } from 'rollup';
import { attempt } from './utils/attempt.ts';

/**
 * Rollup error with import trace property
 */
export type RollupErrorWithTrace = RollupError & {
	importTrace?: string[];
};

// Every read and write here is best-effort. An error object can refuse any of
// them, such as a frozen error or a Proxy, and the original error must still
// reach the caller unchanged, so each one runs inside attempt().

// Matches indentation of error stack traces
const indent = ' '.repeat(4);
const traceHeader = '\n\nImport trace:\n';

const formatTrace = (trace: string[]) => `${traceHeader}${trace
	.map((filePath, index) => {
		const prefix = index === 0 ? indent : `${indent}↳ `;
		return `${prefix}${filePath}`;
	})
	.join('\n')}\n`;

const framesPattern = /^\n\s+at /;

// Find the stack header for a message: `<name>: <message>`, or `<name>` alone
// for an empty message. The name comes from the stack, because Rollup keeps
// the header of a stack it copies from another error. The header must be
// followed by the frames or the end of the stack, so a longer message that
// starts with this one does not match.
const getStackName = (stack: string, message: string) => {
	const nameEnd = message ? stack.indexOf(': ') : stack.search(/\n|$/);
	const name = stack.slice(0, nameEnd);
	if (nameEnd < 1 || /\n|: /.test(name)) {
		return;
	}

	const rest = stack.slice(message ? nameEnd + 2 + message.length : nameEnd);
	const matches = (message === '' || stack.startsWith(message, nameEnd + 2))
		&& (rest === '' || framesPattern.test(rest));
	return matches
		? {
			name,
			rest,
		}
		: undefined;
};

// By default, console.error() and util.inspect() print error.stack. V8 formats
// the stack once, with the message at that time, and Rollup copies the stack
// of the errors it wraps, so changing the message alone does not change the
// stack. Like Rollup (tweakStackMessage) and Vite (enhanceRollupError), the
// stack header is rewritten in the same step as the message. A header that
// is not the original message was changed by someone else, so it is left as is.
const patchStack = (
	error: object,
	originalStack: string,
	originalMessage: string,
	patchedMessage: string,
) => {
	const header = getStackName(originalStack, originalMessage);
	if (header) {
		(error as { stack: string }).stack = `${header.name}: ${patchedMessage}${header.rest}`;
	}
};

const readStack = (error: object) => (
	'stack' in error && typeof error.stack === 'string' ? error.stack : undefined
);

type TraceableError = {
	message: string;
	importTrace: string[];
};

const hasImportTrace = (error: unknown): error is TraceableError => (
	typeof error === 'object'
	&& error !== null
	&& 'message' in error
	&& typeof error.message === 'string'
	&& 'importTrace' in error
	&& Array.isArray(error.importTrace)
);

/**
 * Patches an error's message with its import trace.
 * Reads the `importTrace` property and appends a formatted trace to the message.
 * It also rewrites the stack header, which `console.error()` and
 * `util.inspect()` print by default, when that header is the original message.
 */
export const patchErrorWithTrace = (error: unknown): void => {
	attempt(() => {
		if (!hasImportTrace(error) || error.message.includes(traceHeader)) {
			return;
		}

		const originalMessage = error.message;
		const patchedMessage = originalMessage + formatTrace(error.importTrace);

		// Read before the message changes, so V8 formats an unread stack with
		// the original message
		const originalStack = attempt(() => readStack(error));
		attempt(() => {
			error.message = patchedMessage;
		});
		if (originalStack !== undefined) {
			attempt(() => patchStack(error, originalStack, originalMessage, patchedMessage));
		}
	});
};

/**
 * Attach a trace to an error from Rollup or Vite and format it. If the error
 * does not store the new importTrace, it is left as it is rather than
 * formatting an older one.
 */
export const setImportTrace = (error: object, trace: string[]) => {
	const isStored = attempt(() => {
		(error as RollupErrorWithTrace).importTrace = trace;
		return (error as RollupErrorWithTrace).importTrace === trace;
	});
	if (isStored) {
		patchErrorWithTrace(error);
	}
};
