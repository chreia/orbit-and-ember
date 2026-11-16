import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { recentFirePlugin } from './server/fireFeed.mjs';
import { worldGridPlugin } from './server/worldGrid.mjs';
import { alertRelayPlugin } from './server/alertRelay.mjs';

// The synthetic bundle is only a fallback for development: leave it out of a build that has real data.
function dropMockWhenRealData(): Plugin {
  let outDir = 'dist';
  return {
    name: 'focos-drop-mock',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      if (existsSync(resolve(outDir, 'data', 'manifest.json'))) {
        rmSync(resolve(outDir, 'data-mock'), { recursive: true, force: true });
      }
    },
  };
}

// Relative base so the built app works from any static path.
export default defineConfig({
  base: './',
  plugins: [react(), dropMockWhenRealData(), worldGridPlugin(), recentFirePlugin(), alertRelayPlugin()],
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  preview: { host: '127.0.0.1', port: 5181, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
