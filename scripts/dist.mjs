// Cross-shell wrapper: forces NSIS/electron-builder to use a project-local TEMP
// dir, then runs electron-vite build + electron-builder.
//
// Reason: NSIS uses %TEMP% for transient include files. On some Windows setups
// it falls back to C:\Windows\TEMP which a regular user can't write to,
// producing:
//   !include: could not find: "C:\Windows\TEMP\nstXXXX.tmp"
// Pointing TEMP/TMP at a directory inside the project avoids the issue.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv, exit, platform } from 'node:process';

const projectRoot = resolve(import.meta.dirname, '..');
const tempDir = resolve(projectRoot, '.nsis-temp');
mkdirSync(tempDir, { recursive: true });

const publish = argv.includes('--publish') ? 'always' : 'never';

const env = {
  ...process.env,
  TEMP: tempDir,
  TMP: tempDir
};

function run(cmd, args) {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      env,
      cwd: projectRoot,
      shell: platform === 'win32'
    });
    child.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}`))));
    child.on('error', rej);
  });
}

try {
  await run('npx', ['electron-vite', 'build']);
  await run('npx', ['electron-builder', '--win', '--x64', `--publish=${publish}`]);
} catch (err) {
  console.error('\n[dist] build failed:', err.message);
  exit(1);
}
