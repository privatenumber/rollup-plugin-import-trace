# Vite dev server

Last verified against Vite 7.3.1 source and Vite 7.3.7 behavior, 2026-11-05.

## Short-path roots make the dev server serve raw files

On Windows, a dev server whose `root` is an 8.3 short path, such as `C:\Users\RUNNER~1\...`, can stop transforming files partway through a process. After that point, files that Vite loads from disk are served as raw static files with status 200 and are not added to the module graph. Modules that a plugin `load` hook returns are not affected. GitHub's `windows-latest` runners return such a path from `os.tmpdir()`.

### Mechanism

1. On Windows, `safeRealpathSync` starts as JS `fs.realpathSync`, which keeps short names. On first use it starts `exec('net use')`. When that command succeeds and finds no mapped network drives, Vite switches to `fs.realpathSync.native`, which expands short names to long names. With mapped drives it switches to a wrapper around the same native function. It keeps JS `fs.realpathSync` if native realpath fails with `EISDIR` or `net use` fails ([`utils.ts#L680-L736`](https://github.com/vitejs/vite/blob/v7.3.1/packages/vite/src/node/utils.ts#L680-L736)).
2. Module IDs then use the long path, but `server.fs.allow` still comes from the short-path `root`. `isFileLoadingAllowed` returns false ([`static.ts#L292-L312`](https://github.com/vitejs/vite/blob/v7.3.1/packages/vite/src/node/server/middlewares/static.ts#L292-L312)).
3. `loadAndTransform` skips the file read and throws `ERR_LOAD_URL` before it adds the module to the graph ([`transformRequest.ts#L260-L336`](https://github.com/vitejs/vite/blob/v7.3.1/packages/vite/src/node/server/transformRequest.ts#L260-L336)).
4. The transform middleware handles `ERR_LOAD_URL` by calling `next()` ([`transform.ts#L320-L323`](https://github.com/vitejs/vite/blob/v7.3.1/packages/vite/src/node/server/middlewares/transform.ts#L320-L323)), so the static middleware serves the untransformed file.

Whether a request runs before or after the switch depends on timing, so the failure is intermittent.

### Experiment

[Actions run 42022783453](https://github.com/privatenumber/rollup-plugin-import-trace/actions/runs/42022783453) ran a script on `windows-latest`. The script started a dev server on a fixture, fetched `index.js`, waited 10 seconds for the switch, and then fetched again. Output on Node.js 26.13.0; Node.js 24.11.0 printed the same results:

```
short: 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\fs-fixture-n7fTtg',
native: 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\fs-fixture-n7fTtg'
short root, before switch: transformed
short root, after switch: raw
native root, after switch: transformed
```

A root resolved with `fs.realpathSync.native` works on both sides of the switch. The project's response is in [testing.md](../rollup-plugin-import-trace/testing.md#canonical-fixture-paths).

## Request errors are logged after the error middleware runs

When a module request fails, Vite passes the error to the connect error middlewares. The plugin registers its middleware from a `configureServer` post hook. Vite runs post hooks before it registers its own error middleware ([`server/index.ts#L963-L974`](https://github.com/vitejs/vite/blob/v7.3.1/packages/vite/src/node/server/index.ts#L963-L974)). Vite's middleware then logs the error through `config.logger.error` with an `Internal server error: ` prefix ([`error.ts#L47-L50`](https://github.com/vitejs/vite/blob/v7.3.1/packages/vite/src/node/server/middlewares/error.ts#L47-L50)), so the logged message includes the import trace that the plugin appended. A `customLogger` receives these messages whatever the `logLevel`, because `createLogger` returns a custom logger unchanged ([`logger.ts#L72-L73`](https://github.com/vitejs/vite/blob/v7.3.1/packages/vite/src/node/logger.ts#L72-L73)).

When Vite serves a module, it also pre-transforms that module's static imports in the background. A syntax error in an imported module is then logged a second time, with a `Pre-transform error: ` prefix. That log does not go through the error middleware, so it has no import trace. Observed with Vite 7.3.7: requesting `b.js`, which imports a broken `broken.js`, and then `broken.js` logged both messages. Only the `Internal server error` message had the trace ([`tests/specs/vite-dev.ts`](../../tests/specs/vite-dev.ts)).
