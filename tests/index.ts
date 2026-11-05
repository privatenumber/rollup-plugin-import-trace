import { describe, setProcessTimeout } from 'manten';

// Kill process if tests don't complete in 2 minutes
setProcessTimeout(2 * 60 * 1000);

describe('rollup-plugin-import-trace', () => {
	import('./specs/format.ts');
	import('./specs/rollup.ts');
	import('./specs/vite-build.ts');
	import('./specs/vite-dev.ts');
	import('./specs/package.ts');
});
