import { describe, setProcessTimeout, configure } from 'manten';

// Kill process if tests don't complete in 2 minutes
setProcessTimeout(2 * 60 * 1000);

configure({ snapshotPath: 'tests/.manten.snap' });

describe('rollup-plugin-import-trace', () => {
	import('./specs/rollup.ts');
	import('./specs/vite-build.ts');
	import('./specs/vite-dev.ts');
	import('./specs/patch-error.ts');
	import('./specs/types.ts');
});
