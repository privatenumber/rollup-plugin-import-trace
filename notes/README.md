# Engineering research notes

Tracked maintainer references for the tools and contracts that shape rollup-plugin-import-trace. The npm package ships only `dist/` (`package.json#files`), so these notes are not published.

## Ownership

Each upstream folder owns that tool's behavior, implementation, configuration, and version boundaries. The rollup-plugin-import-trace folder owns project policy, integration, and cross-tool synthesis, and links to upstream evidence.

## Index

| Folder | Owns |
| --- | --- |
| [vite/](./vite/README.md) | Vite dev server and build behavior the plugin and its tests depend on |
| [rolldown/](./rolldown/README.md) | Rolldown plugin behavior that decides whether the plugin can support Rolldown |
| [rollup-plugin-import-trace/](./rollup-plugin-import-trace/README.md) | Project policy, integration, and cross-tool synthesis |

## Evidence

Cite upstream facts beside the claim using primary sources accessible to the intended readers, preferably pinned releases or commits. Ground project behavior in repository source or tests, and label decisions with their rationale. Distinguish documented and observed behavior from inference. Keep executable contracts in the test suite.

## Maintenance

When upstream evidence changes, update the notes and identify affected project decisions and tests. Make implementation or packaging changes only when they are within the requested scope.
