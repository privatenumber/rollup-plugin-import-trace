import { describe, setProcessTimeout } from 'manten';
import * as rollup4 from 'rollup';
import * as rollup3 from 'rollup3';
import * as vite7 from 'vite';
import * as vite6 from 'vite6';
import * as vite5 from 'vite5';
import { type Rollup, rollupSpecs } from './specs/rollup.ts';
import { viteBuildSpecs } from './specs/vite-build.ts';
import { viteDevSpecs } from './specs/vite-dev.ts';
import type { Vite } from './utils/vite.ts';

// Kill process if tests don't complete in 2 minutes
setProcessTimeout(2 * 60 * 1000);

// Each supported peer major. The older majors are installed under aliases.
// Their types differ from the newest major's in ways the specs do not use,
// so they are cast.
const rollups = [rollup4, rollup3 as unknown as Rollup];
const vites = [vite7, vite6 as unknown as Vite, vite5 as unknown as Vite];

// Awaiting the groups keeps the parent group open until their tests finish.
// Otherwise the tests' abort signals fire as soon as the group returns.
describe('rollup-plugin-import-trace', async () => {
	await Promise.all([
		import('./specs/patch-error.ts'),
		...rollups.map(rollup => rollupSpecs(rollup)),
		...vites.map(vite => viteBuildSpecs(vite)),
		...vites.map(vite => viteDevSpecs(vite)),
		import('./specs/package.ts'),
	]);
});
