import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// the project version lives in one file at the repository root
const version = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();

// The multiplayer client is one self-contained HTML file, built into ./public and served by the game server.
export default defineConfig({
  root: 'client',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [viteSingleFile()],
  build: { outDir: '../public', emptyOutDir: true, minify: true, cssMinify: true, target: 'es2020' },
});
