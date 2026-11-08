# rollup-plugin-import-trace

Project policy and integration decisions.

- [testing.md](./testing.md): how the test suite is structured, why it observes the plugin the way it does, and how it covers each supported Rollup and Vite major and the oldest supported Node.js.
- [replay.md](./replay.md): how the plugin recovers import edges that Rollup drops when a resolver throws, the evidence for which replayed results count, and the rejected alternatives.
- [error-stack.md](./error-stack.md): how the import trace reaches `error.stack`, the precedent in Rollup and Vite, and the alternatives that were rejected.
