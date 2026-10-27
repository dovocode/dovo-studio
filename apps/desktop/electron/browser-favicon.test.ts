import { expect, it } from 'vite-plus/test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadBrowserFaviconModule } from './browser-favicon.js'

it('loads the packaged favicon helper from the resources runtime without falling back to workspace links', async () => {
  const resources = await mkdtemp(join(tmpdir(), 'dovo-favicon-module-'))
  try {
    // Spaces match the installed app path. No runtime package exists in app.asar.
    const directory = join(resources, 'Dovo Studio.app/Contents/Resources')
    const runtime = join(directory, 'runtime/node_modules/@dovo/runtime')
    await mkdir(runtime, { recursive: true })
    await writeFile(
      join(runtime, 'package.json'),
      JSON.stringify({
        name: '@dovo/runtime',
        type: 'module',
        exports: { './browser-favicon': './favicon.js' },
      }),
    )
    await writeFile(
      join(runtime, 'favicon.js'),
      'export const createBrowserFaviconLoader = () => "packaged-runtime"',
    )
    expect(
      loadBrowserFaviconModule(directory).createBrowserFaviconLoader(
        () => Promise.reject(),
        () => {},
      ),
    ).toBe('packaged-runtime')
    await rm(join(directory, 'runtime'), { recursive: true })
    // Node may search NODE_PATH or ancestor node_modules after a missing package.
    // Explicitly resolve the installed package file before loading it.
    expect(() => loadBrowserFaviconModule(join(resources, 'missing'))).toThrow(/ENOENT/)
  } finally {
    await rm(resources, { recursive: true, force: true })
  }
})

it('loads the real development module and decodes an icon', async () => {
  const { createBrowserFaviconLoader } = loadBrowserFaviconModule()
  let favicon: string | null | undefined
  const loader = createBrowserFaviconLoader(
    () => Promise.reject(new Error('No network expected')),
    (value) => {
      favicon = value
    },
  )
  await loader.load('https://packaging.invalid', [
    'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>',
      ),
  ])
  expect(favicon).toMatch(/^data:image\/png;base64,/)
  loader.reset()
})
