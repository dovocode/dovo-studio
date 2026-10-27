import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { createTiming, timeMacSigning } from './release-timing.mjs'

function clock() {
  let time = 0
  return { now: () => time, advance: (seconds) => (time += seconds * 1000) }
}

await test('wrapped methods keep their receiver, arguments, results and errors', async () => {
  const { now, advance } = clock()
  const timing = createTiming({ now, log: () => {} })
  const packager = {
    signed: [],
    async doSign(options) {
      advance(90)
      this.signed.push(options.app)
      return 'signed'
    },
    helper: {
      async notarizeIfProvided() {
        advance(420)
        throw new Error('notary rejected')
      },
    },
  }
  timeMacSigning(timing, packager)
  timeMacSigning(timing, packager)
  assert.equal(await packager.doSign({ app: 'Dovo.app' }), 'signed')
  assert.deepEqual(packager.signed, ['Dovo.app'])
  await assert.rejects(packager.helper.notarizeIfProvided('Dovo.app'), /notary rejected/)
  assert.deepEqual(timing.stages, [
    { label: 'Mac code signing', seconds: 90, outcome: 'ok' },
    { label: 'Mac notarization', seconds: 420, outcome: 'failed' },
  ])
})

await test('reports stages to the GitHub step summary once each', async () => {
  const { now, advance } = clock()
  const timing = createTiming({ now, log: () => {} })
  const end = timing.start('Mise archive')
  advance(2.5)
  end()
  end()
  const directory = await mkdtemp(join(tmpdir(), 'dovo-timing-'))
  try {
    timing.report(join(directory, 'summary.md'))
    assert.equal(
      await readFile(join(directory, 'summary.md'), 'utf8'),
      '\n| Packaging stage | Duration | Outcome |\n| --- | ---: | --- |\n| Mise archive | 2.5s | ok |\n',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

await test('installed electron-builder signs, then notarizes, before afterSign', () => {
  // Guards the wrapped method names and their order if electron-builder is upgraded.
  const builderRequire = createRequire(createRequire(import.meta.url).resolve('electron-builder'))
  // Load the package entry first so its internal circular imports resolve in order.
  builderRequire('app-builder-lib')
  const { MacPackager } = builderRequire('app-builder-lib/out/macPackager.js')
  const { MacTargetHelper } = builderRequire('app-builder-lib/out/mac/MacTargetHelper.js')
  const { PlatformPackager } = builderRequire('app-builder-lib/out/platformPackager.js')
  assert.equal(typeof MacTargetHelper.prototype.notarizeIfProvided, 'function')
  const sign = MacPackager.prototype.sign.toString()
  const signing = sign.indexOf('this.doSign(')
  const notarizing = sign.indexOf('this.helper.notarizeIfProvided(')
  assert.ok(signing > 0 && notarizing > signing)
  const afterPack = PlatformPackager.prototype.doSignAfterPack.toString()
  assert.ok(afterPack.indexOf('this.signApp(') < afterPack.indexOf('emitAfterSign('))
})
