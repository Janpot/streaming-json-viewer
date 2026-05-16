import { defineConfig } from 'tsdown';
import { surfaceBuildErrors } from './tools/surface-build-errors.ts';

export default defineConfig((cliOptions) => {
  const watch = Boolean(cliOptions.watch);

  return {
    entry: ['src/index.ts', 'src/streaming.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    // `clean` deletes all of dist/ before each rebuild. In watch mode that
    // delete-storm makes the docs site's bundler (which resolves the package
    // through the workspace symlink) thrash. Only clean for one-shot builds;
    // in watch, overwrite in place and rely on surfaceBuildErrors() to make
    // failed rebuilds visible in the browser instead of serving stale code.
    clean: !watch,
    sourcemap: true,
    plugins: watch ? [surfaceBuildErrors({ label: 'streaming-json-viewer' })] : [],
  };
});
