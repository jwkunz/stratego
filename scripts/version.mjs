#!/usr/bin/env node
// The project's version lives in one file, VERSION, at the repository root.
//   - the web and server builds read it directly (vite configs), and so does the Android build (versionName, and
//     versionCode = major*10000 + minor*100 + patch);
//   - npm needs a version in each package.json (and lock file), so those are kept in step by this script.
//
//   node scripts/version.mjs                 print the version
//   node scripts/version.mjs set 2.2.0       change the version everywhere
//   node scripts/version.mjs check [tag]     fail if anything disagrees (and if `tag`, e.g. v2.2.0, is not this version)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const SEMVER = /^\d+\.\d+\.\d+$/;
const NPM_PROJECTS = ['single/web', 'server'];

export const currentVersion = () => read('VERSION').trim();

function mismatches(version) {
  const bad = [];
  for (const dir of NPM_PROJECTS) {
    const pkg = JSON.parse(read(`${dir}/package.json`));
    if (pkg.version !== version) bad.push(`${dir}/package.json says ${pkg.version}`);
    const lock = JSON.parse(read(`${dir}/package-lock.json`));
    if (lock.version !== version) bad.push(`${dir}/package-lock.json says ${lock.version}`);
    if (lock.packages && lock.packages[''] && lock.packages[''].version !== version) bad.push(`${dir}/package-lock.json (root package) says ${lock.packages[''].version}`);
  }
  const gradle = read('single/Android/app/build.gradle.kts');
  if (!/rootProject\.file\("\.\.\/\.\.\/VERSION"\)/.test(gradle)) bad.push('single/Android/app/build.gradle.kts does not read VERSION');
  for (const f of ['single/web/vite.config.js', 'server/vite.config.js', 'server/vite.android.config.js']) {
    if (!/VERSION/.test(read(f))) bad.push(`${f} does not read VERSION`);
  }
  return bad;
}

const [cmd, arg] = process.argv.slice(2);
if (!cmd) {
  console.log(currentVersion());
} else if (cmd === 'set') {
  if (!SEMVER.test(arg || '')) { console.error('Usage: node scripts/version.mjs set MAJOR.MINOR.PATCH'); process.exit(2); }
  writeFileSync(join(root, 'VERSION'), `${arg}\n`);
  for (const dir of NPM_PROJECTS) {
    for (const file of ['package.json', 'package-lock.json']) {
      const p = join(root, dir, file);
      const json = JSON.parse(readFileSync(p, 'utf8'));
      json.version = arg;
      if (json.packages && json.packages['']) json.packages[''].version = arg;
      writeFileSync(p, `${JSON.stringify(json, null, 2)}\n`);
    }
  }
  console.log(`Version is now ${arg} (VERSION, package.json and package-lock.json of ${NPM_PROJECTS.join(' and ')}).`);
} else if (cmd === 'check') {
  const v = currentVersion();
  const problems = SEMVER.test(v) ? mismatches(v) : [`VERSION is "${v}", expected MAJOR.MINOR.PATCH`];
  if (arg && arg !== `v${v}`) problems.push(`the tag ${arg} does not match VERSION ${v} (expected v${v})`);
  if (problems.length) { console.error(`Version problems:\n  - ${problems.join('\n  - ')}`); process.exit(1); }
  console.log(`All version files agree: ${v}${arg ? ` (tag ${arg})` : ''}`);
} else {
  console.error('Usage: node scripts/version.mjs [set X.Y.Z | check [tag]]');
  process.exit(2);
}
