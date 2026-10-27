import { build } from 'esbuild'
import { readdir } from 'node:fs/promises'
import { createRequire, isBuiltin } from 'node:module'
import { join } from 'node:path'

/** Check emitted imports against the staged app, without workspace dependency links. */
export async function verifyDesktopImports(application) {
  const directory = join(application, 'dist-electron')
  for (const file of await readdir(directory, { recursive: true })) {
    if (!/\.[cm]?js$/.test(file)) continue
    const entry = join(directory, file)
    const { metafile } = await build({
      entryPoints: [entry],
      bundle: false,
      platform: 'node',
      format: 'esm',
      metafile: true,
      write: false,
      logLevel: 'silent',
    })
    const require = createRequire(entry)
    for (const output of Object.values(metafile.outputs))
      for (const imported of output.imports) {
        if (imported.path === 'electron' || isBuiltin(imported.path)) continue
        try {
          require.resolve(imported.path)
        } catch (cause) {
          throw new Error(`Packaged desktop import is missing: ${imported.path} (${file})`, {
            cause,
          })
        }
      }
  }
}
