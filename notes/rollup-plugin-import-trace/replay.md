# Recovering import edges by replay

Decision, 2026-11-08: when a plugin's `resolveId` throws, the plugin recovers the missing import edges by replaying the `resolveId` calls it recorded. It accepts an edge only on evidence that another import cannot produce, scans the records from both ends, and gives the replay a time budget. Source: [`src/rollup/recover-edges.ts`](../../src/rollup/recover-edges.ts), [`src/rollup/trace.ts`](../../src/rollup/trace.ts); tests: [`tests/specs/rollup.ts`](../../tests/specs/rollup.ts) and [`tests/specs/vite-build.ts`](../../tests/specs/vite-build.ts).

## Why edges are missing

Rollup stores a module's resolved import only after `resolveId` returns ([Rollup v4.67.5 `ModuleLoader.ts#L615-L632`](https://github.com/rollup/rollup/blob/v4.67.5/src/ModuleLoader.ts#L615-L632)). When a resolver throws, the module graph has no edge for that import, so the graph cannot reach the failing module. `@rollup/plugin-commonjs` loads a package while it resolves it ([vite/plugin-order.md](../vite/plugin-order.md#commonjs--resolver-loads-modules-from-resolveid)), so a syntax error inside a package drops the edge into the package as well.

## How replay accepts an edge

The plugin records each `resolveId` call it sees, with its options, from `buildStart` to `buildEnd`. After a build error, it walks the module graph from the failing file and replays records for the top of the chain until the chain reaches an entry module. A replayed record gives an edge only in three ways:

1. **The resolution succeeds.** The record's importer imports the returned module.
2. **The specifier is an absolute path** equal to the module. `@rollup/plugin-commonjs` resolves modules again by absolute path.
3. **The resolution throws an error whose file is the module** (`loc.file`, `id`, `exporter`, or `path`). This is weaker: the import leads to the module, but can reach it through other modules.

Records are in the order the resolutions started, and replay alternates between the newest and the oldest. A nested resolution starts after the one that contains it, so among the records whose error names the module, the newest is the most direct import. Only the newest end accepts rule 3 at once. The oldest end accepts rules 1 and 2, and keeps a rule 3 match as a fallback.

A trace that does not start at an entry module is not reported. Replay runs third-party resolvers after the build has failed, and one may never settle, so recovery has a 5-second budget. When it runs out, the error has no trace.

## Evidence

Measured 2026-11-08 on macOS with Node.js 24.11.0, Rollup 4.67.5, `@rollup/plugin-node-resolve` 16.0.3, and `@rollup/plugin-commonjs` 29.0.3, unless stated otherwise. The harness built each fixture in a temporary directory and compared `develop` at `c7d138d`, this design, and the alternative (B) below.

### Correctness

| Case | `develop` | This design | (B) |
| --- | --- | --- | --- |
| CommonJS `require()` of a broken file, one and two levels | Complete | Complete | Complete |
| Broken bare package entry, `../` import in a package | Complete | Complete | Complete |
| Resolver that throws only on its first call | Complete | Complete | Complete |
| Two concurrent failures with the same relative specifier, or the same subpath in two packages | Complete in this run; the reviews found orders where the other importer claims the edge | Complete | Complete |
| Virtual importer (`\0virtual:mod`) | Complete | Complete | Complete |
| A resolver that deletes the import attribute from `options` after reading it | False edge through `a.js` | Complete | Complete |
| Fan-in: `a.js` and `b.js` both import a package whose two files require one broken file | Complete | Complete, through another real path | Complete, through another real path |
| A resolver that never settles on replay | The build error never arrived within 8s | No trace after the budget | Complete |

In Vite 5.4, 6.4, and 7.3 builds, this design also traces a broken package entry imported by a bare name and a CommonJS `require()` chain. Before, both had no trace, because the old fuzzy match could not use a bare specifier. Each mechanism has a test that fails when it is removed: the entry module check, the original options, rule 3's file check, the time budget, and the oldest end's fallback.

### Cost

Successful builds: the plugin records each call and returns `null`. With N modules that each import two others and a CommonJS dependency, the fastest of 7 runs at N = 5,000 was 2,539 ms without the plugin and 2,559 ms with `develop`. Recording stays within noise.

Failed builds with N modules imported by the entry, the fastest of 3 runs:

| N = 5,000 | No plugin | `develop` | This design |
| --- | --- | --- | --- |
| The failing import is recorded last | 1,141 ms | 5,244 ms | 1,137 ms |
| No record matches, a full scan | 1,145 ms | 5,180 ms | 3,134 ms, no trace |
| A CommonJS package with 5,000 internal `require()` calls | 1,277 ms | 2,862 ms | 2,532 ms |

The worst case is one full scan, which `develop` made on most failures. A full scan of 5,000 records took about 2 s, so the budget can cut a scan only in builds that are several times larger.

## Rejected alternatives

- **(B) Wrapping resolution instead of replaying it.** The plugin's `resolveId` would return `await this.resolve(source, importer, { ...options, skipSelf: true })`, record the edge on success, and record the importer with the error object on failure. Rollup keeps the error object's identity, so the failing import is known exactly, and no resolver runs twice. Rejected, because every successful build pays for it, and it changes what users see:
  - It cost 2.6% at N = 5,000 on Node.js 24.11.0 (2,605 ms against 2,539 ms) and 4.5% on Node.js 20.20.0 (3,172 ms against 3,036 ms) in successful builds. The plugin's priority is to work only when a build fails ([CONTRIBUTING.md](../../CONTRIBUTING.md#priorities)).
  - Rollup catches the rethrown error again and sets `error.plugin` to the tracing plugin ([Rollup v4.67.5 `logs.ts#L995-L1015`](https://github.com/rollup/rollup/blob/v4.67.5/src/utils/logs.ts#L995-L1015)), so the error would name `import-trace` instead of the plugin that failed.
  - When the wrapped resolution returns `null`, returning it runs the remaining resolvers again, as `@rollup/plugin-commonjs`'s wrapper does.
- **Matching the specifier's subpath against the failing path**, as before 2026-11-08. Another import whose specifier ends the same way can claim the edge: with two concurrent failures of `./deep/module.js`, `b/index.js` claimed `a/deep/module.js`. It also cannot use a bare specifier or a `../` specifier.
- **Resolving a relative specifier against its importer's directory.** A resolver alias can send a relative specifier elsewhere, and a virtual importer such as `\0virtual:module` has no directory, so it lost a trace that `develop` produced.
- **Accepting rule 3 at both ends.** In a CommonJS package with many `require()` calls, the oldest record is the package import, whose error names the broken file. Accepting it at once produced `index.js ↳ broken.js`, which leaves out the package entry. The trace looked complete but was wrong.
- **Replaying oldest first or newest first only.** Oldest first scanned nearly every record on most failures (5,244 ms above). Newest first was fast for a failure recorded last, but scanned every record for `@rollup/plugin-commonjs`'s package import, which is among the oldest.

## Precedent

Bundlers that report an import chain record the importer while they build the module graph, then walk it from the failing module, following one importer: webpack's `getIssuer()` for `stats.moduleTrace` ([`Compilation.js#L1916-L1924`](https://github.com/webpack/webpack/blob/v5.101.3/lib/Compilation.js#L1916-L1924), [`DefaultStatsFactoryPlugin.js#L466-L490`](https://github.com/webpack/webpack/blob/v5.101.3/lib/stats/DefaultStatsFactoryPlugin.js#L466-L490)), which Next.js formats as "Import trace for requested module" ([`parseNotFoundError.ts#L34-L47`](https://github.com/vercel/next.js/blob/v15.5.3/packages/next/src/build/webpack/plugins/wellknown-errors-plugin/parseNotFoundError.ts#L34-L47)), and Rolldown's importer records for resolve errors ([`module_loader.rs#L807-L845`](https://github.com/rolldown/rolldown/blob/v1.0.0-rc.10/crates/rolldown/src/module_loader/module_loader.rs#L807-L845)). They own graph construction. A Rollup plugin sees only the hooks, which is why the missing edges need replay. esbuild's maintainer suggests observing `onResolve` calls for a failed build ([evanw/esbuild#1904](https://github.com/evanw/esbuild/issues/1904#issuecomment-1004473014)).

## Known limits

- A stateful resolver can answer differently on replay. Rule 1 then accepts an edge the build never had. Copying the options only at replay time does not protect against a resolver that changed external state.
- When several real chains reach the failing module, the trace shows one of them, which may not be the one that failed first.
- A build that is several times larger than 5,000 modules can exhaust the budget on a full scan and get no trace.

## What would change the decision

- Rollup recording an edge, or the importer, for a resolution that throws. The graph alone would then reach the failing module, and replay could be removed.
- A Rollup hook that observes a resolution's result without becoming part of the resolution, which would give (B)'s exact failure without its cost.
- A measured cost for (B) under 1% of a successful build, together with a way to keep `error.plugin`.
