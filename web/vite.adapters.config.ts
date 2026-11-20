// Optional subpath builds: dist-lib/react.js ('otto-mascot/react') and dist-lib/gemini.js ('otto-mascot/gemini'). Runs after
// vite.lib.config.ts (emptyOutDir is off). Unlike the element build, React is the host's here (external), and the dynamic
// import of the element stays a dynamic import of the built root module, so no element code lands in these bundles.
import path from 'node:path'
import { defineConfig } from 'vite'

const elementEntry = path.resolve(import.meta.dirname, 'src/otto/element/index.ts')

export default defineConfig({
  build: {
    outDir: 'dist-lib',
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: { react: 'src/otto/react/index.ts', gemini: 'src/otto/gemini/index.ts' },
      formats: ['es'],
    },
    rollupOptions: {
      external: (id, _importer, isResolved) =>
        ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'].includes(id) ||
        (isResolved && path.normalize(id).replace(/\.[jt]sx?$/, '') === elementEntry.replace(/\.ts$/, '')) ||
        (!isResolved && id === '../element/index'),
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
        // The external element is the sibling root bundle, whichever form the id arrives in.
        paths: id => (/element[\\/]index(\.ts)?$/.test(id) ? './otto-mascot.js' : id),
      },
      onwarn(w, warn) {
        // Rolldown keeps the 'use client' directive of react/index.ts (check-dist asserts it); its warning is noise.
        if (w.code === 'MODULE_LEVEL_DIRECTIVE' && w.id?.replace(/\\/g, '/').includes('/otto/react/')) return
        warn(w)
      },
    },
  },
})
