import { describe, setProcessTimeout } from 'manten';

// Kill process if tests don't complete in 2 minutes
setProcessTimeout(2 * 60 * 1000);

// Awaiting the imports keeps the group open until its tests finish.
// Otherwise the tests' abort signals fire as soon as the group returns.
describe('rollup-plugin-import-trace', async () => {
	await Promise.all([
		import('./specs/format.ts'),
		import('./specs/rollup.ts'),
		import('./specs/vite-build.ts'),
		import('./specs/vite-dev.ts'),
		import('./specs/package.ts'),
	]);
});
