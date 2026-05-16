import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { NormalizedOutputOptions, OutputBundle, Plugin } from 'rolldown';

// ESC[…m color codes; built without a literal control char so eslint's
// no-control-regex stays happy.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

export interface SurfaceBuildErrorsOptions {
  /** Prefix for the thrown message, e.g. the package name. Default: "Build". */
  label?: string;
}

interface EntryInfo {
  /** Absolute path of the emitted entry file. */
  path: string;
  /** True for ES-module output (needs re-declared exports to pass static checks). */
  esm: boolean;
  /** Exported names of the entry chunk. */
  exports: readonly string[];
}

/**
 * tsdown/rolldown plugin for watch mode.
 *
 * When a rebuild fails, rolldown leaves the previous (working) bundles on disk,
 * so a bundler consuming them keeps serving stale code and the error is only
 * visible in the CLI. This plugin instead overwrites each entry bundle with a
 * module that throws the build error, surfacing it wherever the bundle is
 * imported (browser overlay, test runner, etc.). The next successful build
 * overwrites the stubs with real output.
 *
 * The stub re-declares the entry's named exports because bundlers like
 * Turbopack statically validate `import { X } from 'pkg'` — without the names
 * every importer fails at compile time with "Export X doesn't exist" (a
 * separate error storm) and the throw never runs. `export` after an
 * unconditional `throw` is unreachable but syntactically present, so static
 * checks pass while the throw fires at module evaluation.
 *
 * Generic: entry filenames, output dir and format are discovered from the
 * bundle, so it works for any `entry`/`format` configuration. Use it only in
 * watch builds (a one-shot build should fail loudly instead).
 */
export function surfaceBuildErrors(options: SurfaceBuildErrorsOptions = {}): Plugin {
  const label = options.label ?? 'Build';
  // fileName -> info, captured from the last successful build (survives the
  // failed build, where generateBundle never runs).
  const entries = new Map<string, EntryInfo>();

  return {
    name: 'surface-build-errors',
    generateBundle(outputOptions: NormalizedOutputOptions, bundle: OutputBundle) {
      const dir = outputOptions.dir ?? (outputOptions.file ? dirname(outputOptions.file) : '.');
      const esm = outputOptions.format === 'es';
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.isEntry) {
          entries.set(chunk.fileName, {
            path: join(dir, chunk.fileName),
            esm,
            exports: chunk.exports,
          });
        }
      }
    },
    buildEnd(error?: Error) {
      if (!error) return;
      const message = error.message.replace(ANSI, '');
      const thrower = `throw new Error(${JSON.stringify(`[${label}] build failed:\n${message}`)});\n`;

      for (const entry of entries.values()) {
        let stub = thrower;
        if (entry.esm && entry.exports.length > 0) {
          const decls = entry.exports
            .map((n) =>
              n === 'default' ? 'export default undefined;' : `export const ${n} = undefined;`,
            )
            .join('\n');
          stub = `${thrower}${decls}\n`;
        }
        mkdirSync(dirname(entry.path), { recursive: true });
        writeFileSync(entry.path, stub);
      }
    },
  };
}
