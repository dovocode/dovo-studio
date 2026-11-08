import assert from 'node:assert/strict'
import { test, mock } from 'node:test'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { configureMacNotarization } from './mac-notarization.mjs'
import { createTiming } from './release-timing.mjs'

const builder = createRequire(createRequire(import.meta.url).resolve('electron-builder'))
const packager = createRequire(builder.resolve('app-builder-lib'))
const notarizeRequire = createRequire(packager.resolve('@electron/notarize'))
const { notarize } = notarizeRequire('./index.js')
const transport = notarizeRequire('./spawn.js')

for (const accepted of [true, false]) {
  await test(`installed notarizer preserves signature checks and ${accepted ? 'staples accepted submissions' : 'rejects failed submissions without stapling'}`, async () => {
    const commands = []
    const logs = []
    const timing = createTiming({ log: (line) => logs.push(line) })
    const original = mock.method(transport, 'spawn', async (command, args, options) => {
      commands.push({ command, args, options })
      if (args[0] === 'notarytool' && args[1] === 'submit')
        return {
          code: accepted ? 0 : 1,
          output: JSON.stringify({ id: 'fixture-id', status: accepted ? 'Accepted' : 'Invalid' }),
        }
      return { code: 0, output: '{}' }
    })
    const restore = configureMacNotarization(timing)
    try {
      const task = notarize({
        appPath: '/Applications/Dovo Test.app',
        appleId: 'fixture@example.com',
        appleIdPassword: 'fixture-secret',
        teamId: 'fixture-team',
      })
      if (accepted) await task
      else await assert.rejects(task, /Failed to notarize/)
      assert.equal(commands.filter((c) => c.command === 'codesign').length, 2)
      const zip = commands.find((c) => c.command === 'ditto')
      assert.deepEqual(zip.args.slice(0, -1), [
        '--zlibCompressionLevel',
        '1',
        '-c',
        '-k',
        '--sequesterRsrc',
        '--keepParent',
        'Dovo Test.app',
      ])
      assert.equal(zip.options.cwd, '/Applications')
      const submit = commands.find((c) => c.args[1] === 'submit')
      assert.ok(submit.args.includes('--wait'))
      assert.ok(
        submit.args.map(String).includes('fixture-secret'),
        'Library authentication arguments remain intact',
      )
      assert.equal(commands.filter((c) => c.args[0] === 'stapler').length, accepted ? 1 : 0)
      assert.equal(
        timing.stages.find((s) => s.label === 'Notarization upload and Apple processing').outcome,
        accepted ? 'ok' : 'failed',
      )
      assert.ok(timing.stages.some((s) => s.label === 'Notarization ZIP (compression level 1)'))
      assert.doesNotMatch(logs.join('\n'), /fixture-secret|fixture@example.com|fixture-team/)
    } finally {
      restore()
      original.mock.restore()
    }
  })
}

await test('transport failures propagate unchanged and are timed as failures', async () => {
  const failure = new Error('upload connection failed')
  const transport = {
    spawn: async () => {
      throw failure
    },
  }
  const timing = createTiming({ log: () => {} })
  const restore = configureMacNotarization(timing, transport)
  try {
    await assert.rejects(
      transport.spawn('xcrun', ['notarytool', 'submit']),
      (error) => error === failure,
    )
    assert.equal(timing.stages[0].outcome, 'failed')
  } finally {
    restore()
  }
})

await test(
  'Mac notarization ZIP round-trips executable contents and framework symlinks',
  { skip: process.platform !== 'darwin' },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'dovo-notary-zip-'))
    const timing = createTiming({ log: () => {} })
    const restore = configureMacNotarization(timing)
    try {
      const contents = join(root, 'Dovo Test.app/Contents')
      await mkdir(contents, { recursive: true })
      await writeFile(join(contents, 'binary'), '#!/bin/sh\necho Dovo\n')
      await chmod(join(contents, 'binary'), 0o755)
      await symlink('binary', join(contents, 'Current'))
      const archive = join(root, 'upload.zip')
      const result = await transport.spawn(
        'ditto',
        ['-c', '-k', '--sequesterRsrc', '--keepParent', 'Dovo Test.app', archive],
        { cwd: root },
      )
      assert.equal(result.code, 0, result.output)
      const extracted = join(root, 'extracted')
      execFileSync('ditto', ['-x', '-k', archive, extracted])
      const binary = join(extracted, 'Dovo Test.app/Contents/binary')
      assert.equal(await readFile(binary, 'utf8'), '#!/bin/sh\necho Dovo\n')
      assert.equal(execFileSync(binary, { encoding: 'utf8' }).trim(), 'Dovo')
      assert.equal(await readlink(join(extracted, 'Dovo Test.app/Contents/Current')), 'binary')
    } finally {
      restore()
      await rm(root, { recursive: true, force: true })
    }
  },
)
