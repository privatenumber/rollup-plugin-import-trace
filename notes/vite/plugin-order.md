# Vite plugin order and resolveId

Last verified against Vite 7.3.1 source, `@rollup/plugin-commonjs` 29.0.0 source, and Vite 7.3.7 behavior, 2026-11-05.

## Vite's resolver runs before normal user plugins

Vite builds its plugin list in this order: user plugins with `enforce: 'pre'`, then core plugins including `vite:resolve`, then normal user plugins ([`plugins/index.ts#L55-L77`](https://github.com/vitejs/vite/blob/v7.3.1/packages/vite/src/node/plugins/index.ts#L55-L77)). `vite:resolve` resolves relative paths and packages, and a resolved ID ends the `resolveId` chain. A normal user plugin's `resolveId` therefore runs only for specifiers that no core plugin resolved.

## commonjs--resolver loads modules from resolveId

In builds, Vite enables `@rollup/plugin-commonjs` for `node_modules` (Vite 7.3.1 depends on `^29.0.0`). Its `options` hook prepends a `commonjs--resolver` plugin to the plugin list ([`index.js#L190-L199`](https://github.com/rollup/plugins/blob/commonjs-v29.0.0/packages/commonjs/src/index.js#L190-L199)). That plugin's `resolveId` resolves the import with `this.resolve(..., { skipSelf: true })`, which runs the rest of the chain. For a result that may be CommonJS, it then calls `this.load()` ([`resolve-id.js#L110-L145`](https://github.com/rollup/plugins/blob/commonjs-v29.0.0/packages/commonjs/src/resolve-id.js#L110-L145)). It returns earlier for `require()` calls it marks itself, virtual IDs, external results, and IDs that cannot be CommonJS ([`resolve-id.js#L61-L67`](https://github.com/rollup/plugins/blob/commonjs-v29.0.0/packages/commonjs/src/resolve-id.js#L61-L67)). A syntax error in the loaded module therefore throws from `resolveId`, and Rollup records no import edge for it. The error is labeled `[commonjs--resolver]`.

## Consequence for this plugin

The plugin recovers dropped edges by replaying the `resolveId` calls it recorded. With normal order, the nested `this.resolve()` stops at `vite:resolve` before it reaches the plugin, so nothing is recorded. `enforce: 'pre'` puts the plugin ahead of `vite:resolve`, but not ahead of Vite's alias plugin, other `enforce: 'pre'` plugins listed earlier, or hooks with `order: 'pre'`. Observed with Vite 7.3.7: without `enforce: 'pre'`, a syntax error in `node_modules/some-lib/broken.js` had no trace; with it, the trace was complete ([`tests/specs/vite-build.ts`](../../tests/specs/vite-build.ts)).

The same order applies to the dev server, so with `enforce: 'pre'` the imports the dev server resolves reach the plugin's `resolveId`. A long-running server can resolve many imports without calling `buildStart`, which clears the records, again. The plugin therefore stops recording once `configureServer` has run, and records again after `closeBundle`, which Vite calls when the server closes ([`tests/specs/vite-dev.ts`](../../tests/specs/vite-dev.ts), [`tests/specs/vite-build.ts`](../../tests/specs/vite-build.ts)).

## Known limitation: replay recovers only the last edge

Replay attaches an importer only to the module that failed. Re-resolving the recorded specifier throws the same error, so the plugin then matches the specifier's subpath against the error path. This recovers `./sub/file.js` and `pkg/sub/file.js` specifiers. It does not recover a bare package name such as `some-lib` (no subpath) or a `../` specifier. When an earlier edge in the chain was also dropped, as in a CommonJS package whose entry `require()`s a broken file, the trace can stop short of the entry point. Observed with Vite 7.3.7: a syntax error in a package's entry file, imported as `some-lib`, still has no trace.
