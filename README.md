# rollup-plugin-import-trace

Rollup plugin that adds import traces to build errors.

A build error names the file that failed, but not how the build reached it. This plugin adds the chain of imports from the entry point to that file:

```
node_modules/some-lib/dist/styles.css (1:0): Expression expected (Note that you need plugins to import files that are not JavaScript)

Import trace:
    /project/src/index.js
    ↳ /project/src/components/Button.js
    ↳ /project/node_modules/some-lib/dist/index.js
    ↳ /project/node_modules/some-lib/dist/styles.css
```

The trace is appended to `error.message` and to the header of `error.stack`, so it appears whether you print the message or the error itself. The same chain is available as an array in `error.importTrace`.

> [!NOTE]
> Rollup errors have a `watchFiles` property that may look similar, but it's just files for watch mode to monitor. It includes all files imported from the entry point, not just the chain that led to the error.

## Install

```sh
npm install rollup-plugin-import-trace
```

## Usage

```ts
import { importTrace } from 'rollup-plugin-import-trace'

export default {
    plugins: [
        importTrace()
        // other plugins...
    ]
}
```

> [!IMPORTANT]
> List `importTrace()` **first** in the plugins array. Its `resolveId` hook needs to run before other plugins to record import relationships for error recovery.

Errors thrown by `rollup()` and `bundle.generate()` or `bundle.write()` include the trace:

```ts
import { rollup } from 'rollup'
import { importTrace } from 'rollup-plugin-import-trace'

try {
    await rollup({
        input: 'src/index.js',
        plugins: [importTrace()]
    })
} catch (error) {
    console.error(error.message) // Ends with the "Import trace:" block
}
```

## Compatibility

| Tool | Supported |
| --- | --- |
| Rollup | 3 and 4 |
| Vite | 5, 6, and 7: builds and the dev server |
| Vite 8 and Rolldown | No |

Vite 5–7 build with Rollup, so the plugin works there as a Vite plugin. It uses `enforce: 'pre'`, so it runs before Vite's own resolver wherever it is listed. List it before other `enforce: 'pre'` plugins. In the dev server, the trace also appears in the error overlay.

Vite 8 builds with Rolldown, which gives plugins a copy of the build error, so the plugin cannot add the trace to the error your build throws.

## `patchErrorWithTrace(error)`

Appends the formatted trace from `error.importTrace` to the message and stack header. The plugin already calls it for every error it traces, so you only need it for an error whose `importTrace` was set some other way. It accepts `unknown`, does nothing if the error has no `importTrace` array, and does nothing if the trace is already in the message.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).
