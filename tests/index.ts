import { describe, setProcessTimeout, configure } from 'manten';

// Kill process if tests don't complete in 2 minutes
setProcessTimeout(2 * 60 * 1000);

configure({ snapshotPath: 'tests/.manten.snap' });

describe('rollup-plugin-import-trace', () => {
	import('./specs/rollup.js');
	import('./specs/vite-build.js');
	import('./specs/vite-dev.js');
	import('./specs/patch-error.js');
	import('./specs/types.js');
});
