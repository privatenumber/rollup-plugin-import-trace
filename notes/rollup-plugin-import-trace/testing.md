# Testing

The suite runs real Rollup builds, Vite builds, a Vite dev server, and the built `dist/` package, all against `fs-fixture` directories. It asserts complete import traces, not fragments of them.

## Complete traces

Rollup and Vite build tests use `expectTrace()` ([`tests/utils/trace.ts`](../../tests/utils/trace.ts)). It compares the whole `importTrace` array with `toStrictEqual`, and checks that the message has the exact formatted block once, with no further trace entry after it. Vite appends a file location and code frame after the block, so the block need not end the message. The Vite dev tests check the formatted block in the logged message, and the package runtime tests check the array and the inspected error.

Decision: partial checks, such as the trace length plus `toContain('a.js')` for each entry, also accept a wrong directory, a mix of short and long Windows paths, or a different file with the same suffix. Strict checks reject all of these.

## Canonical fixture paths

Fixtures are created under `fs.realpathSync.native(os.tmpdir())` instead of `os.tmpdir()` ([`tests/utils/fixture.ts`](../../tests/utils/fixture.ts)).

On Windows CI, `os.tmpdir()` is an 8.3 short path. Vite switches to `fs.realpathSync.native`, which expands it, partway through a process. A dev server with a short-path root then serves raw files ([vite/dev-server.md](../vite/dev-server.md#short-path-roots-make-the-dev-server-serve-raw-files)), which made a dev test flaky ([#3](https://github.com/privatenumber/rollup-plugin-import-trace/issues/3)). `@rollup/plugin-node-resolve` 16.0.3 uses JS `fs.realpath`, which keeps short names, so Rollup-only tests are not affected.

With a canonical root, `fixture.getPath()` matches every module ID once Windows backslashes are converted to forward slashes, as the plugin does, so expected traces can be built from it. `fs-fixture` itself resolves `os.tmpdir()` with JS `fs.realpathSync`, which keeps short names ([privatenumber/fs-fixture#36](https://github.com/privatenumber/fs-fixture/issues/36)). The helper becomes unnecessary when that issue is fixed.

## Vite dev errors are read from the logger

The dev tests capture `logger.error` messages through `customLogger` and check the `Internal server error` message ([`tests/utils/vite.ts`](../../tests/utils/vite.ts)). Vite logs that message after the plugin's error middleware has patched the error ([vite/dev-server.md](../vite/dev-server.md#request-errors-are-logged-after-the-error-middleware-runs)).

Rejected: parsing the error HTML in the 500 response. The test extracted `const error = ...` from Vite's error page and un-escaped `<`. That page is an internal format, not a public contract.

Vite also logs a `Pre-transform error` for the same syntax error, without a trace. The plugin does not trace pre-transform errors today.

## Published package

[`tests/specs/package.ts`](../../tests/specs/package.ts) imports the package by name from a fixture whose `node_modules` links to the repository, so resolution goes through `package.json#exports` to `dist/`:

- One `tsc` run type-checks Rollup and Vite config files against `dist/index.d.ts`.
- One Rollup build each from an ESM and a CommonJS script checks that both `dist/index.mjs` and `dist/index.cjs` attach traces.

All other specs import `src/` directly, so these are the only tests of the published files.

## Verifying that a test can fail

A test that passes before and after a change proves nothing about that change. Each new test was checked by breaking the code it covers and confirming that only the expected tests failed. For example, removing the `resolveRecords` reset in `buildStart` fails only `records from a previous build are not replayed`. Ignoring `dynamicallyImportedIds` fails only `dynamic import`.
