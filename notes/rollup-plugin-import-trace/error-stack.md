# Import trace in error.stack

Decision, 2026-11-06: `patchErrorWithTrace` adds the trace to `error.stack` only by wrapping a native lazy stack accessor (Node.js 22 and newer). Every change it makes to an error is best-effort. Source: [`src/index.ts`](../../src/index.ts) (`patchStack`, `attempt`); tests: [`tests/specs/format.ts`](../../tests/specs/format.ts) and [`tests/specs/package.ts`](../../tests/specs/package.ts).

## Why the stack needs the trace

`console.error(error)` and `util.inspect(error)` print `error.stack` when it exists, not `error.message`. V8 formats the stack text on first read, using the message at that time. For a Rollup syntax error, something reads the stack before the plugin's `buildEnd` hook appends the trace to `message`, so the printed error had no trace. Observed through the built package on Node.js 26.13.0 with Rollup 4.67.5: the trace was in `message` but not in `stack` or `inspect()`. A Vite build error had it in all three.

## Stack property by Node.js version

Observed by calling `Object.getOwnPropertyDescriptor(new Error('Original'), 'stack')`, then changing `message`, then reading `stack`:

| Node.js | Descriptor | Stack shows the later message |
| --- | --- | --- |
| 20.20.2 | data, configurable, writable | no: reading the descriptor formatted the stack |
| 22.23.4 | accessor, configurable | yes |
| 24.22.1 | accessor, configurable | yes |
| 26.13.0 | accessor, configurable | yes |

On Node.js 22 and newer, the plugin can read the descriptor and wrap the getter without formatting the stack. On Node.js 20, even reading the descriptor formats it. The plugin detects the accessor once with a throwaway error and leaves stacks alone on Node.js 20.

## Contract

- **Native accessor:** the wrapper calls the original getter on each read and inserts the latest trace for that error before the stack's trailing `at` frames. An unformatted stack therefore still reflects later message changes. A stack assigned later through the setter also gets the trace. A reused error shows its newest trace.
- **Node.js 20, or a stack defined as a plain value:** not patched. A stack that was formatted before patching keeps lacking the trace. Checked through the built package on Node.js 20.20.2: a Rollup syntax error had no trace in `inspect()`, while a transform error whose stack was still unformatted had both the trace and a later `buildEnd` message prefix.
- **Best-effort:** reading `importTrace`, patching `message`, and patching `stack` each run in their own `try`. A frozen error or a `Proxy` that refuses any step still reaches the caller unchanged, and a read-only `message` does not stop the stack patch.
- **Known limit:** a message that ends with frame-like lines, or a stack that ends with a newline, can get the trace in the wrong position. Only the trailing block of `at` lines counts as frames.

## Rejected alternatives

- **Replacing the message text inside the stack** (first version of PR #10). This read `error.stack`, which formatted a lazy stack early and hid later message changes. It also failed when the stack lacked the current message, and it matched the error name for `new Error('Error')`.
- **Patching data-property stacks** (second version). Reading the descriptor formats the stack on Node.js 20. A data value also loses the trace when another plugin assigns a new stack, and each further case (configurable but read-only, writable but non-configurable) needed its own branch. Review kept finding new cases, so this path was dropped.

Revisit when the package drops Node.js 20 from `engines`: the Node.js 20 detection can then go. Also revisit if V8 changes how `error.stack` is exposed.
