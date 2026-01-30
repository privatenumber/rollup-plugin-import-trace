# rollup-plugin-import-trace

Rollup/Vite plugin that adds import traces to build errors.

When a build error is thrown, the plugin adds an `importTrace` property showing the chain of imports that led to the problematic file:

```
Error [RollupError]: node_modules/some-lib/dist/styles.css (1:0): Expression expected (Note that you need plugins to import files that are not JavaScript)
    at getRollupError (...) {
  code: 'PARSE_ERROR',
  id: '/project/node_modules/some-lib/dist/styles.css',
  loc: { column: 0, file: '/project/node_modules/some-lib/dist/styles.css', line: 1 },
  frame: '1: .class {\n   ^\n2:     color: red;\n3: }',

  // ⬇️ Added by this plugin
  importTrace: [
    '/project/src/index.js',
    '/project/src/components/Button.js',
    '/project/node_modules/some-lib/dist/index.js',
    '/project/node_modules/some-lib/dist/styles.css'
  ]
}
```

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
    plugins: [importTrace()]
}
```

Works with Rollup and Vite (both dev and build modes).

## Formatting Utility

In Vite dev mode, the error message is automatically formatted for the browser overlay:

```
[plugin:vite:import-analysis] Failed to parse source for import analysis because the content contains invalid JS syntax. If you are using JSX, make sure to name the file with the .jsx or .tsx extension.

Import trace:
    /project/index.js
    ↳ /project/a.js
    ↳ /project/b.js
    ↳ /project/broken.js

/project/broken.js:1:30
1  |  export const value = "unclosed
   |                                ^
    at TransformPluginContext._formatLog ...
```

For other cases (e.g. CLI tools), use `patchErrorWithTrace(error)` to format and append the trace to the error message:

```ts
import { importTrace, patchErrorWithTrace } from 'rollup-plugin-import-trace'

try {
    await rollup({
        input: 'src/index.js',
        plugins: [importTrace()]
    })
} catch (error) {
    patchErrorWithTrace(error)
    console.error(error.message)
}
```

Output:

```
node_modules/some-lib/dist/styles.css (1:0): Expression expected (Note that you need plugins to import files that are not JavaScript)

Import trace:
    /project/src/index.js
    ↳ /project/src/components/Button.js
    ↳ /project/node_modules/some-lib/dist/index.js
    ↳ /project/node_modules/some-lib/dist/styles.css
```

> [!TIP]
> `patchErrorWithTrace` accepts `unknown`—safely does nothing if the error doesn't have an `importTrace` array.
