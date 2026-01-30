import { describe, setProcessTimeout, configure } from 'manten';

// Kill process if tests don't complete in 2 minutes
setProcessTimeout(2 * 60 * 1000);

configure({ snapshotPath: 'tests/.manten.snap' });

await describe('rollup-plugin-import-trace', ({ runTestSuite }) => {
	runTestSuite(import('./specs/rollup.js'));
	runTestSuite(import('./specs/vite-build.js'));
	runTestSuite(import('./specs/vite-dev.js'));
	runTestSuite(import('./specs/patch-error.js'));
	runTestSuite(import('./specs/types.js'));
});
