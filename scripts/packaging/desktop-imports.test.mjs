import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyDesktopImports } from './desktop-imports.mjs'

await test('packaging rejects a runtime import that resolves in the workspace but is absent from the app', async () => {
  const resources = await mkdtemp(join(tmpdir(), 'dovo-desktop-imports-'))
  const application = join(resources, 'app.asar')
  try {
    await mkdir(join(application, 'dist-electron'), { recursive: true })
    await writeFile(join(application, 'package.json'), '{"type":"module"}')
    const runtime = join(resources, 'runtime/node_modules/@dovo/runtime')
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
      'export const createBrowserFaviconLoader = () => {}',
    )
    const main = join(application, 'dist-electron/main.js')
    await writeFile(main, "import {app} from 'electron'; import '@dovo/runtime/browser-favicon'")
    await assert.rejects(
      verifyDesktopImports(application),
      /Packaged desktop import is missing: @dovo\/runtime\/browser-favicon/,
    )
    await writeFile(
      main,
      "import {app} from 'electron'; import {createRequire} from 'node:module'; const loader = createRequire(import.meta.url);",
    )
    await writeFile(join(application, 'dist-electron/preload.mjs'), "import 'electron'")
    await verifyDesktopImports(application)
    await writeFile(main, "import './missing-chunk.js'")
    await assert.rejects(verifyDesktopImports(application), /missing-chunk.js/)
  } finally {
    await rm(resources, { recursive: true, force: true })
  }
})
