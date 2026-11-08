# Contributing

## Project direction

The plugin adds the import chain to Rollup build errors, so a failure in a deeply imported file shows how the build reached it.

- **Primary:** Rollup builds. The main consumers are Rollup-based CLIs such as [pkgroll](https://github.com/privatenumber/pkgroll) and [dtsroll](https://github.com/privatenumber/dtsroll), which print `error.message`.
- **Supported because they use Rollup:** Vite 5–7 builds, and the Vite 5–7 dev server.
- **Non-goals:** Vite 8 and Rolldown. Rolldown passes plugins a copy of the build error, so the plugin's approach of adding the trace to the error cannot work there ([notes/rolldown/build-errors.md](./notes/rolldown/build-errors.md)).

## Priorities

1. Never replace or break the original error. Every change to an error is best-effort.
2. Report a correct trace or none. A missing trace is better than a misleading one.
3. Keep the plugin light: it runs in every build, and its work happens only when a build fails.

## Setup

```sh
pnpm install
```

`devEngines.runtime` in `package.json` pins the Node.js version, and pnpm installs it.

## Development

```sh
pnpm build        # Build dist/ with pkgroll
pnpm test         # Build, then run the test suite
pnpm lint         # lintroll
pnpm type-check   # tsc
```

Source layout:

```
src/
  index.ts              plugin assembly (hooks, state) and public exports
  patch-error.ts        appends the trace to an error's message and stack
  get-error-file.ts     the file an error belongs to
  rollup/
    trace.ts            importer map from Rollup's module graph
    recover-edges.ts    recovers import edges that Rollup drops when resolveId throws
  vite/
    dev-server.ts       error middleware for the Vite dev server
  utils/                generic helpers; lint forbids imports from the rest of src/
```

Tests in `tests/specs/` are grouped by behavior: Rollup builds, Vite builds, the Vite dev server, `patchErrorWithTrace`, and the published `dist/` entry points. They use [fs-fixture](https://github.com/privatenumber/fs-fixture) for files and assert complete traces. See [notes/rollup-plugin-import-trace/testing.md](./notes/rollup-plugin-import-trace/testing.md).

The Rollup and Vite specs run once per supported major. The older majors are dev dependencies under aliases (`rollup3`, `vite5`, `vite6`), so `pnpm test` covers every peer version locally and in CI. On Linux, CI also runs the built package with Node.js 20.20.0, the `engines` floor. To run that check locally, set `PACKAGE_TEST_NODE` to a Node.js 20.20.0 binary, for example from `pnpm dlx node@20.20.0 -p process.execPath`. See [notes/rollup-plugin-import-trace/testing.md](./notes/rollup-plugin-import-trace/testing.md#supported-versions).

## Guidelines

- Add a test that fails without your change, through the real Rollup or Vite boundary when possible.
- Do not add runtime dependencies without discussion; the package has none.
- Keep the published API (`importTrace`, `patchErrorWithTrace`, `RollupErrorWithTrace`) and the peer ranges stable. A change to either is a breaking change.

## Essential context

[`notes/`](./notes/README.md) records upstream behavior that the plugin depends on, with sources and experiments:

- Why the trace is also written to `error.stack`: [notes/rollup-plugin-import-trace/error-stack.md](./notes/rollup-plugin-import-trace/error-stack.md)
- Why the plugin uses `enforce: 'pre'` in Vite, and which import edges replay cannot recover: [notes/vite/plugin-order.md](./notes/vite/plugin-order.md)
- Why test fixtures need canonical paths on Windows: [notes/vite/dev-server.md](./notes/vite/dev-server.md)
