# Vite plugin order and resolveId

Last verified against Vite 7.3.1 and 7.3.7 source, Rollup 4.67.5 source, `@rollup/plugin-commonjs` 29.0.0 source, and Vite 7.3.7 behavior, 2026-11-08.

## Vite's resolver runs before normal user plugins

Vite builds its plugin list in this order: user plugins with `enforce: 'pre'`, then core plugins including `vite:resolve`, then normal user plugins ([`plugins/index.ts#L55-L77`](https://github.com/vitejs/vite/blob/v7.3.1/packages/vite/src/node/plugins/index.ts#L55-L77)). `vite:resolve` resolves relative paths and packages, and a resolved ID ends the `resolveId` chain. A normal user plugin's `resolveId` therefore runs only for specifiers that no core plugin resolved.

## commonjs--resolver loads modules from resolveId

In builds, Vite enables `@rollup/plugin-commonjs` for `node_modules` (Vite 7.3.1 depends on `^29.0.0`). Its `options` hook prepends a `commonjs--resolver` plugin to the plugin list ([`index.js#L190-L199`](https://github.com/rollup/plugins/blob/commonjs-v29.0.0/packages/commonjs/src/index.js#L190-L199)). That plugin's `resolveId` resolves the import with `this.resolve(..., { skipSelf: true })`, which runs the rest of the chain. For a result that may be CommonJS, it then calls `this.load()` ([`resolve-id.js#L110-L145`](https://github.com/rollup/plugins/blob/commonjs-v29.0.0/packages/commonjs/src/resolve-id.js#L110-L145)). It returns earlier for `require()` calls it marks itself, virtual IDs, external results, and IDs that cannot be CommonJS ([`resolve-id.js#L61-L67`](https://github.com/rollup/plugins/blob/commonjs-v29.0.0/packages/commonjs/src/resolve-id.js#L61-L67)). A syntax error in the loaded module therefore throws from `resolveId`, and Rollup records no import edge for it. The error is labeled `[commonjs--resolver]`.

## Consequence for this plugin

The plugin recovers dropped edges by replaying the `resolveId` calls it recorded. With normal order, the nested `this.resolve()` stops at `vite:resolve` before it reaches the plugin, so nothing is recorded.

The plugin's `resolveId` is an object hook with `order: 'pre'`. Vite and Rollup run each hook's `order: 'pre'` handlers before all other handlers of that hook, keeping plugin order within each group ([Vite `getSortedPluginsByHook`](https://github.com/vitejs/vite/blob/v7.3.7/packages/vite/src/node/plugins/index.ts#L131-L146), [Rollup `getSortedValidatedPlugins`](https://github.com/rollup/rollup/blob/v4.67.5/src/utils/PluginDriver.ts#L430-L443)). The hook therefore runs before `vite:resolve` and any other `resolveId` without `order: 'pre'`, wherever `importTrace()` is listed. Only another `order: 'pre'` `resolveId` listed earlier runs first. Rollup has supported object hooks with `order` since 2.78, which covers the `^3 || ^4` peer range.

Before 2026-11-08, the plugin used `enforce: 'pre'` alone. That moved it ahead of `vite:resolve`, but Rollup ignores `enforce`, so Rollup users had to list the plugin first. Observed with Vite 7.3.7: with neither `enforce: 'pre'` nor `order: 'pre'`, a syntax error in `node_modules/some-lib/broken.js` had no trace; with `order: 'pre'` alone, it was complete ([`tests/specs/vite-build.ts`](../../tests/specs/vite-build.ts)).

The plugin keeps `enforce: 'pre'` for its dev error middleware. Vite runs the `configureServer` post hooks in the order that `enforce` sorts the plugins, so the middleware the plugin registers there runs before the error middleware of a normal plugin listed earlier, and that middleware sees the trace. Observed with Vite 7.3.7: without `enforce: 'pre'`, an earlier plugin's error middleware received the error with no `importTrace` ([`tests/specs/vite-dev.ts`](../../tests/specs/vite-dev.ts)). Vite sorts `configureServer` with the same `getSortedPluginsByHook` as other hooks, so another plugin's `configureServer` with `order: 'pre'` still runs first, and its error middleware sees no trace.

The same order applies to the dev server, so the imports the dev server resolves reach the plugin's `resolveId`. A long-running server can resolve many imports without calling `buildStart`, which clears the records, again. The plugin therefore stops recording once `configureServer` has run, and records again after `closeBundle`, which Vite calls when the server closes ([`tests/specs/vite-dev.ts`](../../tests/specs/vite-dev.ts), [`tests/specs/vite-build.ts`](../../tests/specs/vite-build.ts)).

## Recovering dropped edges

Replay starts from the file the error points to most specifically (`loc.file`, then `id`). For a CommonJS module whose required file failed to parse, `id` is the requiring module and `loc.file` is the required file. It then replays recorded `resolveId` calls for the top of the chain until it reaches an entry module or recovers no further edge. That loop matters for CommonJS: resolving a package also loads it, so a broken `require()` inside drops the edge into the package as well. A trace that does not reach an entry module is not reported, because it would look complete but start in the middle. Which replayed results count as an edge, and the evidence for that rule, are in [rollup-plugin-import-trace/replay.md](../rollup-plugin-import-trace/replay.md).

Vite builds drop more edges than plain Rollup. Observed 2026-11-08 with Vite 5.4.21, 6.4.5, and 7.3.7, each of these has a complete trace from the entry: a syntax error in a package entry imported by a bare name, one reached through a `../` import inside a package, and a CommonJS `require()` chain ([`tests/specs/vite-build.ts`](../../tests/specs/vite-build.ts)). Before 2026-11-08, replay matched the specifier against the failing path, which a bare or `../` specifier cannot match, so these had no trace.
