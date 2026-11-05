# Import trace in error.stack

Decision, 2026-11-06: when `patchErrorWithTrace` appends the trace to `error.message`, it rewrites the stack header in the same step. It reads the stack before it changes the message. It rewrites the header only when the stack starts with `${name}: ${originalMessage}` followed by a newline or the end of the string. Every change it makes to an error is best-effort. Source: [`src/index.ts`](../../src/index.ts) (`patchErrorWithTrace`, `patchStack`, `attempt`); tests: [`tests/specs/format.ts`](../../tests/specs/format.ts) and [`tests/specs/package.ts`](../../tests/specs/package.ts).

## Why the stack needs the trace

`console.error(error)` and `util.inspect(error)` print `error.stack`, not `error.message`. V8 formats the stack text on first read, using the message at that time, so changing the message later does not change the stack. Rollup also copies the stack string of the errors it wraps: `logModuleParseError` builds a parse error with `stack: error.stack` from the parser's error ([`logs.ts#L976-L993`](https://github.com/rollup/rollup/blob/v4.67.5/src/utils/logs.ts#L976-L993)). Observed through the built package on Node.js 26.13.0 with Rollup 4.67.5, before this change: a Rollup syntax error had the trace in `message` but not in `stack` or `inspect()`. A Vite build error had it in all three, because Vite rebuilds the stack itself (below).

## Precedent

Tools that change the message of an error they did not create also rewrite its stack, eagerly:

- **Rollup:** `tweakStackMessage` runs `error.stack = error.stack.replace(oldMessage, error.message)` ([`logs.ts#L557-L563`](https://github.com/rollup/rollup/blob/v4.67.5/src/utils/logs.ts#L557-L563)). The Rollup CLI then prints the message and removes `${name}: ${message}\n` from the start of the stack ([`cli/logging.ts#L34-L36`](https://github.com/rollup/rollup/blob/v4.67.5/cli/logging.ts#L34-L36)), so it expects the header to match the current message.
- **Vite:** `enhanceRollupError` reads the frames with `extractStack`, which strips `${name}: ${message}\n` only when the stack starts with it, and then sets `e.stack = `${e.message}\n${stackOnly}`` ([`build.ts#L812-L860`](https://github.com/vitejs/vite/blob/v7.3.1/packages/vite/src/node/build.ts#L812-L860)). Its comment states the reason: "we don't have any guarantees that the error we are working with hasn't already had its stack accessed before we get here." This was [vitejs/vite#16540](https://github.com/vitejs/vite/pull/16540), a fix for Rollup errors that lost Vite's added context.
- **vitest** ([`expect/src/utils.ts#L60-L62`](https://github.com/vitest-dev/vitest/blob/main/packages/expect/src/utils.ts#L60-L62)) and **body-parser** ([`json.js#L181-L183`](https://github.com/expressjs/body-parser/blob/master/lib/types/json.js#L181-L183)) replace the old message in the stack with the new one.

Sources accessed 2026-11-06. No inspected tool wraps the stack accessor.

## Contract

- The header is rewritten only when it is exactly the original message. Anchoring on `${name}: ` avoids matching the name, as in `new Error('Error')`. Requiring a newline after the message avoids matching a longer message that starts with the original.
- A stack whose header is something else was changed by another tool, so it is left as is. A message changed later by another plugin also does not reach the stack unless that plugin updates the stack, as Rollup and Vite do.
- The stack is read before the message changes. Otherwise V8 formats an unread stack with the patched message, and the rewrite adds the trace a second time.
- Reading `importTrace`, changing `message`, and changing `stack` are each best-effort, so a frozen error, a read-only property, or a `Proxy` still reaches the caller. On a `Proxy` that forwards reads to its target, assigning `stack` does not reach the target, so the stack keeps its frames without the trace.
- Behavior is the same on Node.js 20, 22, and 26. Observed through the built package on 20.20.2, 22.23.4, and 26.13.0: a Rollup syntax error, a Rollup transform error, and an error whose stack was never read each had exactly one trace in `inspect()`, with a header matching the message. A Vite build error (26.13.0) also had exactly one, after Vite's own rebuild.

## Rejected alternatives

- **Wrapping the stack accessor** so the trace is inserted on read (second to fourth versions of PR #10). Each of four review rounds found a new way it damaged errors. A `Proxy` lost its frames, because the wrapper called V8's getter with the proxy as the receiver. A reused error kept an old trace. On Node.js 20, `stack` is a data property, and reading even its descriptor formats it, so behavior split by Node.js version. It also contradicted the precedent above.
- **Unanchored `stack.replace(originalMessage, …)`** (first version of PR #10). This is what Rollup and vitest do, but for `new Error('Error')` it matches the name instead of the message.
