import { build } from 'esbuild'
export { chromium } from 'playwright'

/** Resolve relative stubs by importer, and reject stale fixtures before launching a browser. */
export async function bundleBrowser(options, stubs) {
  for (const stub of stubs) {
    if (stub.path.startsWith('.') && !stub.importer)
      throw new Error(`Relative browser stub requires an importer: ${stub.path}`)
  }
  const used = new Set()
  const plugin = {
    name: 'browser-fixtures',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path, importer }) => {
        const stub = stubs.find(
          (entry) =>
            entry.path === path && (!entry.importer || importer.startsWith(entry.importer)),
        )
        if (!stub) return
        used.add(stub)
        return { path: String(stubs.indexOf(stub)), namespace: 'browser-fixture' }
      })
      builder.onLoad({ filter: /.*/, namespace: 'browser-fixture' }, ({ path }) => ({
        contents: stubs[Number(path)].contents,
        loader: 'tsx',
        resolveDir: options.stdin?.resolveDir ?? options.absWorkingDir,
      }))
    },
  }
  const result = await build({ ...options, plugins: [...(options.plugins ?? []), plugin] })
  const unused = stubs.filter((stub) => !used.has(stub)).map((stub) => stub.path)
  if (unused.length) throw new Error(`Unused browser stubs: ${unused.join(', ')}`)
  return result
}
