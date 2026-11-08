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

## Supported versions

Decision, 2026-11-08: the suite tests every supported peer major in one run, and CI runs it again on the oldest Node.js in `engines`.

- **Peers:** the older majors are dev dependencies under aliases: `rollup3` (`npm:rollup@^3.30.0`), `vite5`, and `vite6`. [`tests/index.ts`](../../tests/index.ts) passes each module to the Rollup, Vite build, and Vite dev specs, which are factories that take it ([`tests/specs/rollup.ts`](../../tests/specs/rollup.ts), [`tests/utils/vite.ts`](../../tests/utils/vite.ts)). `node_modules/rollup` and `node_modules/vite` stay the newest majors, so the package type test checks the combination users install. This follows [esbuild-loader](https://github.com/privatenumber/esbuild-loader/blob/v4.5.0/tests/index.ts#L1-L19), which installs `webpack5: npm:webpack@^5.0.0` beside webpack 4 and runs its specs once per version.
- **Node.js:** on Linux, CI runs the whole suite again on Node.js 20.20.0, the `engines` floor, with `pnpm dlx node@20.20.0 --import tsx tests/index.ts` (`tsx` 4.23.15, [`.github/workflows/test.yml`](../../.github/workflows/test.yml)). `pnpm test` runs TypeScript with Node.js type stripping, which needs Node.js 22.18 or newer, so the floor run uses `tsx`. It runs against the `dist/` that `pnpm test` built in the step before. pnpm 11 removed `pnpm run --use-node-version`, which esbuild-loader uses for the same purpose ([pnpm/pnpm#10373](https://github.com/pnpm/pnpm/pull/10373)); `pnpm dlx node@<version>` provisions a runtime for one command instead.

Vite 5–7 type their plugins against their own Rollup 4. A project whose own `rollup` is Rollup 3 therefore cannot type-check this plugin in a Vite config. The same is true for any plugin that imports Rollup's types, such as `@rollup/plugin-commonjs`.

### Evidence

Measured 2026-11-08 on macOS with Node.js 26.13.0 and pnpm 12.16.1, unless stated otherwise:

- **Coverage:** the alias suite ran 89 tests. Groups were named `Rollup 3`, `Rollup 4`, and `Vite 5`, `Vite 6`, and `Vite 7` for both `build` and `dev`. A plugin's `buildStart` in the `rollup3` module reported `this.meta.rollupVersion` 3.30.0.
- **Cost:** installing the three aliases took 1s and grew `node_modules/.pnpm` by 25 MB. An emulation of the alias suite ran 98 tests in 1.34–1.42s in the fastest of six alternating runs, against 1.25–1.34s for the 55-test suite. manten runs tests concurrently, so the extra majors add about 0.1s.
- **The floor run uses Node.js 20.20.0.** All 89 tests passed in about 2s with `pnpm dlx node@20.20.0 --import tsx tests/index.ts`. With a Node.js 22-only call (`[1].values().map()`) added to `src/index.ts`, that run failed with `TypeError: [1].values(...).map is not a function`, while `node tests/index.ts` on the pinned Node.js 26.13.0 still passed. Node.js 20.20.0 provides `Symbol.asyncDispose`, which the `await using` statements in the tests need after `tsx` lowers them.
- **The CI matrix was not slower.** In [run 42432963055](https://github.com/privatenumber/rollup-plugin-import-trace/actions/runs/42432963055) of the earlier matrix (#17 at `10d521b`), each compatibility job took 15–20s and ran in parallel with the main jobs. The run took 47s, set by the Windows job's 42s. Speed did not decide the choice.

### Rejected alternatives

- **Running only the `dist/` tests on Node.js 20,** with a CI step that exported a Node.js 20 binary path as `PACKAGE_TEST_NODE` for [`tests/specs/package.ts`](../../tests/specs/package.ts) to spawn. Replaced, because it checked 2 tests instead of the suite, connected the workflow to the test only through an environment variable, and did not run unless the variable was set.
- **A CI matrix job per peer version**, which installed the older version in place of the newest and ran `pnpm test`. Rejected, because `pnpm test` did not cover the older versions: each local check needed a manual install and revert. Windows did not test them either. The Vite type test also needed a cross-major skip, because the installed `rollup` was Rollup 3 while Vite used Rollup 4.
- **A Node.js 20 dev dependency through pnpm's `runtime:` protocol.** With pnpm 12.18.0, `pnpm add -D node20@runtime:20.20.0` failed with `ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER`. `pnpm add -D node@runtime:20.20.0` worked, but linked `node_modules/.bin/node` to 20.20.0, which pnpm scripts find before the pinned runtime, and the TypeScript suite cannot run there.
- **[`get-node`](https://github.com/ehmicky/get-node) 15.0.4 in the test suite**, to download Node.js 20 during `pnpm test`. It installed 108 packages (14 MB), and the first download took 2.0s and used 91 MB of cache per version. Rejected, because it adds network access to the tests and 108 packages for a check of an end-of-life runtime that CI alone can run. Node.js 20 reached end of life on 2026-04-30 ([endoflife.date](https://endoflife.date/nodejs)).

Revisit when `engines` moves to Node.js 22.18 or newer, where the floor run can drop `tsx` and use type stripping like `pnpm test`, or when a supported peer major is added or dropped.

## Verifying that a test can fail

A test that passes before and after a change proves nothing about that change. Each new test was checked by breaking the code it covers and confirming that only the expected tests failed. For example, removing the `resolveRecords` reset in `buildStart` fails only `records from a previous build are not replayed`. Ignoring `dynamicallyImportedIds` fails only `dynamic import`.
