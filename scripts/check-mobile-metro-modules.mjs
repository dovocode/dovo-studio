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
  // Exercise the production Hermes resolver/transformer without starting React Native.
  config.serializer.getModulesRunBeforeMainModule = () => []
  config.reporter = { update() {} }
  await writeFile(
    fixture,
    `
    import {parse} from 'jsonc-parser';
    import {Effect} from 'effect';
    import {jiraReader} from '@dovo/studio-core/jira-reads';
    import {Schema} from 'effect';
    import {changedFileFingerprint} from '@dovo/protocol';
    const reviewFile={path:'mobile.ts',before:'old',after:'new',viewed:false};
    const reviewFingerprint=changedFileFingerprint(reviewFile);
    reviewFile.viewed=true;
    globalThis.metroReviewFingerprint={stable:changedFileFingerprint(reviewFile)===reviewFingerprint};
    reviewFile.after='changed';
    globalThis.metroReviewFingerprint.changed=changedFileFingerprint(reviewFile)!==reviewFingerprint;
    globalThis.metroJiraRead = Effect.runPromise(jiraReader({}, 'paired/account/jira', () => Effect.succeed({value:{ok:true},readVersion:'b'.repeat(64)}))('/api/scm/work/options', {jiraSourceId:'jira'}, Schema.Struct({ok:Schema.Boolean})));
    import {readPullPage} from '@dovo/studio-core/pull-reads';
    globalThis.metroPullRead = Effect.runPromise(readPullPage({}, 'paired/account/repository', () => Effect.succeed({pulls:[],page:1,hasMore:false,readVersion:'a'.repeat(64)})));
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
    customTransformOptions: { engine: 'hermes' },
    unstable_transformProfile: 'hermes-stable',
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
    TextEncoder,
    TextDecoder,
    process,
  }
  runInNewContext(await readFile(output, 'utf8'), context, { timeout: 10000 })
  assert.equal((await context.metroPullRead).page, 1)
  assert.equal((await context.metroJiraRead).ok, true)
  assert.equal(context.metroReviewFingerprint.stable, true)
  assert.equal(context.metroReviewFingerprint.changed, true)
  assert.equal(context.metroThemeResult.name, 'Native theme')
  assert.ok(context.metroEditorDocument.includes('Edit image'))
  assert.equal(context.metroEditorCancel.type, 'cancel')
  console.log(
    'Compiled model catalog, production iOS PR and Jira readers, review fingerprints, theme parser and image editor exports load successfully.',
  )
} finally {
  process.chdir(previousDirectory)
  await rm(fixture, { force: true })
  await rm(temporary, { recursive: true, force: true })
}
