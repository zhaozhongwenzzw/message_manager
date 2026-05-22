import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// The project's package.json sets "type": "module", so Node would parse .cjs
// files according to extension (always CJS) but Electron's loader on some
// versions still needs an explicit hint. Dropping a tiny package.json with
// "type": "commonjs" into each out/* dir removes any ambiguity.
function markAsCjs(dir: string) {
  return {
    name: 'mark-as-cjs',
    writeBundle(): void {
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, 'package.json'), '{ "type": "commonjs" }');
    }
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), markAsCjs(resolve(__dirname, 'out/main'))],
    build: {
      // Force CommonJS output for the main process. Electron's ESM main loader
      // (Node 20.18 / 22.x bundled) has a CJS preparse bug on Windows that
      // crashes on startup. CJS sidesteps the entire ESM/CJS interop path.
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        output: { format: 'cjs' }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin(), markAsCjs(resolve(__dirname, 'out/preload'))],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs' }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@assets': resolve(__dirname, 'src/assets')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
});
