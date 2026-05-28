// Cross-shell wrapper: forces NSIS/electron-builder to use a project-local TEMP
// dir, then runs electron-vite build + electron-builder.
//
// Reason: NSIS uses %TEMP% for transient include files. On some Windows setups
// it falls back to C:\Windows\TEMP which a regular user can't write to,
// producing:
//   !include: could not find: "C:\Windows\TEMP\nstXXXX.tmp"
// Pointing TEMP/TMP at a directory inside the project avoids the issue.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv, exit, platform } from 'node:process';

const projectRoot = resolve(import.meta.dirname, '..');
const tempDir = resolve(projectRoot, '.nsis-temp');
mkdirSync(tempDir, { recursive: true });

// Auto-load .env (Node 20.6+). Keeps GH_TOKEN out of the shell history and
// out of committed files — the project's .gitignore excludes .env.
const envFile = resolve(projectRoot, '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
  console.log(`[dist] loaded env from ${envFile}`);
}

const publish = argv.includes('--publish') ? 'always' : 'never';
const versionBumpByFlag = new Map([
  ['-p', 'patch'],
  ['-m', 'minor'],
  ['-M', 'major']
]);
const releaseFlags = argv.slice(2).filter((flag) => versionBumpByFlag.has(flag));
const unknownFlags = argv
  .slice(2)
  .filter((flag) => flag.startsWith('-') && flag !== '--publish' && !versionBumpByFlag.has(flag));

if (unknownFlags.length > 0) {
  console.error(`[dist] unknown flag: ${unknownFlags.join(', ')}`);
  exit(1);
}

if (releaseFlags.length > 1) {
  console.error(`[dist] 只能选择一种版本升级方式：-p, -m, -M`);
  exit(1);
}

if (publish === 'never' && releaseFlags.length > 0) {
  console.error('[dist] -p / -m / -M 只能和 --publish 一起使用');
  exit(1);
}

const versionBump = publish === 'always' && releaseFlags.length > 0
  ? versionBumpByFlag.get(releaseFlags[0])
  : null;

if (publish === 'always' && !process.env.GH_TOKEN) {
  console.error(
    '[dist] GH_TOKEN 没有设置。请把 token 写到项目根目录的 .env 文件（参考 .env.example），' +
      '或者在当前 shell 里 export GH_TOKEN=...'
  );
  exit(1);
}

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

function gitCapture(args) {
  const r = spawnSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf-8',
    shell: platform === 'win32'
  });
  if (r.status !== 0) return '';
  return (r.stdout || '').trim();
}

/**
 * Build release notes from commits since the previous semver tag.
 *
 * - We run BEFORE `npm version`, so HEAD is the last real feature commit and
 *   the "previous tag" is the latest `v*` tag (i.e. the last shipped version).
 * - Commits whose message is just a bare semver ("0.3.3" — the auto-commit
 *   `npm version` creates) are filtered out: they're release housekeeping,
 *   not changelog material.
 * - Spec/scratch commits (`docs(spec):`) are also dropped — internal design
 *   docs aren't useful to end users.
 * - Output is plain markdown bullets so it renders in both GitHub release
 *   and the in-app update dialog (react-markdown).
 */
function buildReleaseNotes() {
  // Find the most recent semver tag that contains at least one meaningful
  // commit (not just bare "X.Y.Z" version bumps). This handles the case where
  // a prior release failed partway and left orphan tags behind — we skip over
  // them so the notes include all real changes since the last *shipped* version.
  const bareSemver = /^v?\d+\.\d+\.\d+$/;
  const allTags = gitCapture(['tag', '--list', 'v[0-9]*', '--sort=-v:refname']);
  const tags = allTags ? allTags.split('\n').map((t) => t.trim()).filter(Boolean) : [];

  let prevTag = '';
  for (const tag of tags) {
    // Skip tags on HEAD itself (this is the release we're about to create).
    const tagSha = gitCapture(['rev-parse', tag]);
    const headSha = gitCapture(['rev-parse', 'HEAD']);
    if (tagSha === headSha) continue;

    // Check whether the range from this tag to HEAD has real commits.
    const probe = gitCapture(['log', `${tag}..HEAD`, '--no-merges', '--pretty=format:%s']);
    const meaningful = (probe || '')
      .split('\n')
      .filter(Boolean)
      .filter((l) => !bareSemver.test(l.trim()))
      .filter((l) => !l.trim().startsWith('docs(spec):'));
    if (meaningful.length > 0) {
      prevTag = tag;
      break;
    }
  }

  const range = prevTag ? `${prevTag}..HEAD` : 'HEAD~20..HEAD';
  const raw = gitCapture(['log', range, '--no-merges', '--pretty=format:%s']);
  if (!raw) return null;

  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !bareSemver.test(l))
    .filter((l) => !l.startsWith('docs(spec):'));

  if (lines.length === 0) return null;

  const headerRange = prevTag ? `${prevTag} → HEAD` : '初始版本';
  return [`## 更新内容（${headerRange}）`, '', ...lines.map((l) => `- ${l}`), ''].join('\n');
}

try {
  // Fail fast if the working tree is dirty — `npm version` would commit+tag
  // and then the subsequent build step might fail, leaving orphan tags behind.
  if (versionBump) {
    const dirty = gitCapture(['status', '--porcelain']);
    if (dirty) {
      console.error('[dist] Git 工作目录不干净，请先提交或 stash 再发布:\n' + dirty);
      exit(1);
    }
  }

  // Generate release notes BEFORE bumping version — `npm version` creates an
  // empty "X.Y.Z" commit, which we want to exclude from the diff.
  if (publish === 'always') {
    const notes = buildReleaseNotes();
    const notesPath = resolve(projectRoot, 'RELEASE_NOTES.md');
    if (notes) {
      writeFileSync(notesPath, notes, 'utf-8');
      console.log(`[dist] wrote ${notesPath} (${notes.split('\n').length} lines)`);
    } else {
      // electron-builder will silently skip releaseNotesFile if it doesn't
      // exist, but a stub keeps the GitHub release body non-empty.
      writeFileSync(notesPath, '## 更新内容\n\n（无变更说明）\n', 'utf-8');
      console.log('[dist] no commits in range; wrote stub RELEASE_NOTES.md');
    }
  }

  if (versionBump) {
    await run('npm', ['version', versionBump]);
  }
  await run('npx', ['electron-vite', 'build']);
  await run('npx', ['electron-builder', '--win', '--x64', `--publish=${publish}`]);
} catch (err) {
  console.error('\n[dist] build failed:', err.message);
  exit(1);
}
