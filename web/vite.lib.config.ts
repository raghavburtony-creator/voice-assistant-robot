// The otto-mascot library: `npm run build:lib` -> dist-lib/otto-mascot.js (ES module, defines <otto-mascot>) plus a lazily
// loaded chunk for the robot's WebGL scene, and dist-lib/types (from tsconfig.lib.json).
//
// Dependencies: React and ReactDOM render Otto inside his shadow root and are bundled, so a page needs nothing else (a
// React app gets a second, private copy, isolated in the element). There is no Three.js: the robot is one WebGL 2 shader.
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist-lib',
    emptyOutDir: true,
    sourcemap: true,
    lib: { entry: 'src/otto/element/index.ts', formats: ['es'], fileName: () => 'otto-mascot.js' },
    rollupOptions: { output: { chunkFileNames: 'chunks/[name]-[hash].js' } },
  },
})
