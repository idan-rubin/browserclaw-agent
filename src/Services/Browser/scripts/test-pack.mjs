#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const pkgDir = resolve(new URL('..', import.meta.url).pathname);
const { name } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

const workDir = mkdtempSync(join(tmpdir(), 'pack-smoke-'));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

try {
  console.log(`[pack-smoke] Packing ${name} into ${workDir}`);
  run('npm', ['pack', '--pack-destination', workDir], pkgDir);

  const tarball = readdirSync(workDir).find(f => f.endsWith('.tgz'));
  if (!tarball) throw new Error('npm pack produced no tarball');

  const installDir = join(workDir, 'consumer');
  mkdirSync(installDir, { recursive: true });
  run('npm', ['init', '-y'], installDir);
  run('npm', ['install', join(workDir, tarball), '--no-audit', '--no-fund'], installDir);

  console.log(`[pack-smoke] Importing ${name} from installed tarball`);
  const script = `import('${name}').then(m => { if (Object.keys(m).length === 0) { console.error('empty module'); process.exit(1); } console.log('exports:', Object.keys(m).join(', ')); }).catch(e => { console.error(e); process.exit(1); });`;
  run('node', ['--input-type=module', '-e', script], installDir);

  console.log('[pack-smoke] OK');
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
