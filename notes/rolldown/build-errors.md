# Rolldown build errors in plugin hooks

Last verified against Rolldown 1.3.0 on Node.js 26.13.0, 2026-11-06. Vite 8.3.6 depends on `rolldown ~1.2.16`, which was not tested separately.

## Conclusion

Rolldown passes `buildEnd` a copy of the build error. Changing that object, which is how this plugin attaches the trace under Rollup, has no effect on the error the caller receives. This is why the project does not support Vite 8 or Rolldown ([CONTRIBUTING.md](../../CONTRIBUTING.md#project-direction)).

## Observations

Each experiment built a fixture where `index.js` imports `a.js`, which imports `broken.js` (`export const v = "unclosed`), with `rolldown({ input, plugins }).then(bundle => bundle.generate())`. Rolldown reports build errors from `generate()`, not from `rolldown()`.

1. **The module graph is available.** A plugin's `buildEnd` saw `getModuleIds()` and `getModuleInfo(id).importedIds` as `index.js → [a.js]`, `a.js → [broken.js]`, `broken.js → []`. The plugin's Rollup trace logic could build the full chain.
2. **`buildEnd` receives an aggregate.** The argument was an `Error` whose only own key was `errors`, an array with one entry. That entry had `code`, `kind`, `message`, `id` (`broken.js`), `plugin`, `frame`, `exporter`, `loc`, and `pos`.
3. **Changes to it do not propagate.** A plugin appended `[PATCHED]` to `error.errors[0].message` and set `error.errors[0].importTrace` in `buildEnd`. The error from `generate()` had a different `errors[0]` object, and neither the patched message nor `importTrace` appeared in it, in the aggregate message, or in `util.inspect()`.
4. **Throwing from `buildEnd` does propagate.** A plugin that threw a new `Error` from `buildEnd` with `Import trace:` in its message produced a final error whose message and `errors[0].message` both contained the trace. `errors[0].code` became `PLUGIN_ERROR`, and the aggregate message attributed the error to that plugin (`[plugin thrower] …`), so the original `PARSE_ERROR` code and attribution were lost.

No issue or documentation in [rolldown/rolldown](https://github.com/rolldown/rolldown) describes the copy behavior (searched 2026-11-06 for `buildEnd error`, `buildEnd mutate error`, and `error object identity plugin`).

## What would change the decision

- Rolldown passing the original error to `buildEnd`, or another hook that can change the error the caller receives.
- Rolldown or Vite adding the import chain to errors natively, which would make this plugin unnecessary there.
- Demand from Vite 8 users strong enough to accept observation 4's trade-off: a rethrown error with the trace but with this plugin's code and attribution.
