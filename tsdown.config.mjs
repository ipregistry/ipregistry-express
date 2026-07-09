import { defineConfig } from 'tsdown'

// Plain JavaScript so the config loads on every supported Node version:
// loading a .ts config requires either Node 22.18+ type stripping or
// tsdown's optional 'unrun' peer dependency.
export default defineConfig({
    entry: {
        index: 'src/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    minify: false,
    target: 'es2022',
    external: ['express', '@ipregistry/client'],
    outputOptions: {
        // The default export intentionally accompanies the named exports
        // (helmet-style importing); CJS consumers reach it via `.default`.
        exports: 'named',
    },
})
