# Vite

Vite behavior that the plugin and its tests depend on.

- [dev-server.md](./dev-server.md): when the dev server serves raw files instead of transformed modules (Windows short paths), and how it logs request errors.
- [plugin-order.md](./plugin-order.md): why Vite builds drop import edges for node_modules errors, and why the plugin uses `enforce: 'pre'`.
