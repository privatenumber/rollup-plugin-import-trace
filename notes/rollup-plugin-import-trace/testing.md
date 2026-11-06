# Testing

The suite runs real Rollup builds, Vite builds, a Vite dev server, and the built `dist/` package, all against `fs-fixture` directories. It asserts complete import traces, not fragments of them.

## Complete traces

Rollup and Vite build tests use `expectTrace()` ([`tests/utils/trace.ts`](../../tests/utils/trace.ts)). It compares the whole `importTrace` array with `toStrictEqual`, and checks that the message has the exact formatted block once, with no further trace entry after it. Vite appends a file location and code frame after the block, so the block need not end the message. The Vite dev tests check the formatted block in the logged message, and the package runtime tests check the array and the inspected error.

Decision: partial checks, such as the trace length plus `toContain('a.js')` for each entry, also accept a wrong directory, a mix of short and long Windows paths, or a different file with the same suffix. Strict checks reject all of these.

## Canonical fixture paths

Fixtures must live under a canonical path, with no Windows 8.3 short names. `fs-fixture` 2.16.1 and newer creates them under `fs.promises.realpath(os.tmpdir())`, which uses the native implementation and expands short names ([privatenumber/fs-fixture#36](https://github.com/privatenumber/fs-fixture/issues/36)), so the specs call its `createFixture` directly.

On Windows CI, `os.tmpdir()` is an 8.3 short path. Vite switches to `fs.realpathSync.native`, which expands it, partway through a process. A dev server with a short-path root then serves raw files ([vite/dev-server.md](../vite/dev-server.md#short-path-roots-make-the-dev-server-serve-raw-files)), which made a dev test flaky ([#3](https://github.com/privatenumber/rollup-plugin-import-trace/issues/3)). `@rollup/plugin-node-resolve` 16.0.3 uses JS `fs.realpath`, which keeps short names, so Rollup-only tests are not affected.

With a canonical root, `fixture.getPath()` matches every module ID once Windows backslashes are converted to forward slashes, as the plugin does, so expected traces can be built from it. Keep `fs-fixture` at 2.16.1 or newer: with an older version, the Vite dev tests become flaky on Windows again.

## Vite dev errors are read from the logger

The dev tests capture `logger.error` messages through `customLogger` and check the `Internal server error` message ([`tests/utils/vite.ts`](../../tests/utils/vite.ts)). Vite logs that message after the plugin's error middleware has patched the error ([vite/dev-server.md](../vite/dev-server.md#request-errors-are-logged-after-the-error-middleware-runs)).

Rejected: parsing the error HTML in the 500 response. The test extracted `const error = ...` from Vite's error page and un-escaped `<`. That page is an internal format, not a public contract.

Vite also logs a `Pre-transform error` for the same syntax error, without a trace. The plugin does not trace pre-transform errors today.

## Published package

[`tests/specs/package.ts`](../../tests/specs/package.ts) imports the package by name from a fixture whose `node_modules` links to the repository, so resolution goes through `package.json#exports` to `dist/`:

- One `tsc` run with `bundler` resolution type-checks Rollup and Vite config files. The `import` condition gives them `dist/index.d.mts`.
- One `tsc` run with `node16` resolution type-checks an `.mts` and a `.cts` consumer. A value import in a `.cts` file compiles to `require`, so it resolves the `require` condition and must get `dist/index.d.cts`; an ESM-only declaration fails it with `TS1479`. A dynamic `import()`, or an `import type` with `resolution-mode: 'import'`, resolves the `import` condition instead.
- One Rollup build each from an ESM and a CommonJS script checks that both `dist/index.mjs` and `dist/index.cjs` attach traces.

All other specs import `src/` directly, so these are the only tests of the published files.

The top-level `types` field points to `dist/index.d.ts`, a third copy of the declarations. TypeScript before 4.7 ignores `exports` and cannot read a `.d.cts` file through `types`. Observed with TypeScript 4.6.4, `module: commonjs`, `moduleResolution: node`, `skipLibCheck: true`, and Rollup 4.67.5: `types: ./dist/index.d.cts` failed with `TS7016`, and `./dist/index.d.ts` passed. `skipLibCheck` is needed because Rollup 4's own declarations use `Symbol.asyncDispose`, which TypeScript 4.6 rejects. The fallback fixes how this package's types resolve, not compatibility with every dependency's types. No test covers this, because it would need an old TypeScript as a dev dependency.

## Verifying that a test can fail

A test that passes before and after a change proves nothing about that change. Each new test was checked by breaking the code it covers and confirming that only the expected tests failed. For example, removing the `resolveRecords` reset in `buildStart` fails only `records from a previous build are not replayed`. Ignoring `dynamicallyImportedIds` fails only `dynamic import`.
