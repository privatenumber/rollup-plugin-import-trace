import fs from 'node:fs';
import os from 'node:os';
import { createFixture as createFsFixture, type FileTree } from 'fs-fixture';

// On Windows CI, os.tmpdir() is an 8.3 short path (C:\Users\RUNNER~1\...).
// Vite switches to fs.realpathSync.native partway through a process, which
// expands it, so a short-path dev server root starts serving raw files.
// Creating fixtures under the canonical path makes every module ID and
// fixture.getPath() agree. See notes/vite/dev-server.md
// https://github.com/privatenumber/fs-fixture/issues/36
const temporaryDirectory = fs.realpathSync.native(os.tmpdir());

export const createFixture = (fileTree: FileTree) => createFsFixture(fileTree, {
	tempDir: temporaryDirectory,
});
