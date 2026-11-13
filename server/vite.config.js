import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// The multiplayer client is one self-contained HTML file, built into ./public and served by the game server.
export default defineConfig({
  root: 'client',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [viteSingleFile()],
  build: { outDir: '../public', emptyOutDir: true, minify: true, cssMinify: true, target: 'es2020' },
});
