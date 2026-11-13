import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// the project version lives in one file at the repository root
const version = readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim();

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [viteSingleFile()],
  build: { minify: true, cssMinify: true, target: 'es2020' },
});
