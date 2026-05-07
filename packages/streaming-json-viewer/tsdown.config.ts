import { defineConfig } from 'tsdown';
import { copyFileSync } from 'node:fs';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  external: ['react', 'react-dom'],
  clean: true,
  sourcemap: true,
  hooks: {
    'build:done': () => {
      copyFileSync('src/styles.css', 'dist/styles.css');
    },
  },
});
