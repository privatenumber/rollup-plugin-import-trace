# Vite plugin order and resolveId

Last verified against Vite 7.3.1 source, `@rollup/plugin-commonjs` 29.0.0 source, and Vite 7.3.7 behavior, 2026-11-05.

## Vite's resolver runs before normal user plugins

Vite builds its plugin list in this order: user plugins with `enforce: 'pre'`, then core plugins including `vite:resolve`, then normal user plugins ([`plugins/index.ts#L55-L77`](https://github.com/vitejs/vite/blob/v7.3.1/packages/vite/src/node/plugins/index.ts#L55-L77)). `vite:resolve` resolves relative paths and packages, and a resolved ID ends the `resolveId` chain. A normal user plugin's `resolveId` therefore runs only for specifiers that no core plugin resolved.

## commonjs--resolver loads modules from resolveId

In builds, Vite enables `@rollup/plugin-commonjs` for `node_modules` (Vite 7.3.1 depends on `^29.0.0`). Its `options` hook prepends a `commonjs--resolver` plugin to the plugin list ([`index.js#L190-L199`](https://github.com/rollup/plugins/blob/commonjs-v29.0.0/packages/commonjs/src/index.js#L190-L199)). That plugin's `resolveId` resolves the import with `this.resolve(..., { skipSelf: true })`, which runs the rest of the chain, and then calls `this.load()` on the result ([`resolve-id.js#L110-L145`](https://github.com/rollup/plugins/blob/commonjs-v29.0.0/packages/commonjs/src/resolve-id.js#L110-L145)). A syntax error in the loaded module therefore throws from `resolveId`, and Rollup records no import edge for it. The error is labeled `[commonjs--resolver]`.

## Consequence for this plugin

The plugin recovers dropped edges by replaying the `resolveId` calls it recorded. With normal order, the nested `this.resolve()` stops at `vite:resolve` before it reaches the plugin, so nothing is recorded. `enforce: 'pre'` puts the plugin ahead of `vite:resolve`. Observed with Vite 7.3.7: without `enforce: 'pre'`, a syntax error in `node_modules/some-lib/broken.js` had no trace; with it, the trace was complete ([`tests/specs/vite-build.ts`](../../tests/specs/vite-build.ts)).

The same order applies to the dev server, so with `enforce: 'pre'` every import of every request reaches the plugin's `resolveId`. The dev server calls `buildStart`, which clears the records, only once, so the plugin stops recording once `configureServer` has run ([`tests/specs/vite-dev.ts`](../../tests/specs/vite-dev.ts)).
