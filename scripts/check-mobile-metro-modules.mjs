import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runInNewContext } from 'node:vm'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = join(root, 'apps/mobile')
const previousDirectory = process.cwd()
const temporary = await mkdtemp(join(tmpdir(), 'dovo-metro-modules-'))
const fixture = join(root, 'packages/studio-core', `.metro-modules-${process.pid}.js`)
try {
  process.chdir(mobile)
  const require = createRequire(join(mobile, 'package.json'))
  const clientRuntime = await import(require.resolve('@dovo/client-runtime'))
  assert.equal(typeof clientRuntime.ModelCatalogCache, 'function')
  assert.equal(typeof clientRuntime.imageEditorDocument, 'function')
  assert.equal(typeof clientRuntime.parseImageEditorResult, 'function')
  const metro = createRequire(require.resolve('@expo/metro-config'))('metro')
  const config = await require('@expo/metro-config').loadUserConfig({
    projectRoot: mobile,
    serverRoot: root,
  })
  // Exercise the real production resolver/transformer without starting React Native.
  config.serializer.getModulesRunBeforeMainModule = () => []
  config.reporter = { update() {} }
  await writeFile(
    fixture,
    `
    import {parse} from 'jsonc-parser';
    import {imageEditorDocument,parseImageEditorResult} from '../client-runtime/dist/images/image-editor.js';
    globalThis.metroEditorDocument = imageEditorDocument('data:image/png;base64,AA==');
    globalThis.metroEditorCancel = parseImageEditorResult({channel:'dovo-image-editor',type:'cancel'});
    globalThis.metroThemeResult = parse('{ /* theme */ "name": "Native theme", "colors": {}, }');
  `,
  )
  const output = join(temporary, 'modules.js')
  await metro.runBuild(config, {
    entry: fixture,
    out: output,
    platform: 'ios',
    dev: false,
    minify: true,
    maxWorkers: 2,
  })
  const context = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    performance,
    process,
  }
  runInNewContext(await readFile(output, 'utf8'), context, { timeout: 10000 })
  assert.equal(context.metroThemeResult.name, 'Native theme')
  assert.ok(context.metroEditorDocument.includes('Edit image'))
  assert.equal(context.metroEditorCancel.type, 'cancel')
  console.log(
    'Compiled model catalog, production iOS theme parser and image editor exports load successfully.',
  )
} finally {
  process.chdir(previousDirectory)
  await rm(fixture, { force: true })
  await rm(temporary, { recursive: true, force: true })
}
