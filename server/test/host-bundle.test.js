import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

test('the Android host page builds into one self-contained file that needs only the app\'s native bridge', async () => {
  const out = mkdtempSync(join(tmpdir(), 'stratego-host-'));
  try {
    await build({
      configFile: fileURLToPath(new URL('../vite.android.config.js', import.meta.url)),
      logLevel: 'silent',
      build: { outDir: out, emptyOutDir: true },
    });
    assert.deepEqual(readdirSync(out), ['lan-host.html']);
    const html = readFileSync(join(out, 'lan-host.html'), 'utf8');
    assert.ok(!/node:/.test(html), 'no Node-only imports in the bundle');
    const refs = [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(refs.every((r) => r.startsWith('data:')), `no external files (found ${refs.filter((r) => !r.startsWith('data:'))})`);
    for (const needle of ['NativeHost', 'StrategoBridge', '__stratego_host', 'Stop hosting', 'hoststop']) assert.ok(html.includes(needle), needle);
    assert.ok(html.length < 250_000, `reasonable size (${html.length})`);
  } finally { rmSync(out, { recursive: true, force: true }); }
});
