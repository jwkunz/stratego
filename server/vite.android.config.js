import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// The host page for the Android app: the multiplayer client plus the game host, as one self-contained HTML file.
// The ordinary client page (served to other devices) is the normal build in ./public.
export default defineConfig({
  root: 'client',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [viteSingleFile()],
  build: {
    outDir: '../dist-android', emptyOutDir: true, minify: true, cssMinify: true, target: 'es2020',
    rollupOptions: { input: fileURLToPath(new URL('./client/lan-host.html', import.meta.url)) },
  },
});
