import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, copyFile, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('postinstall scopes GPUI assets, preserves ordinary installs and stops on failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-postinstall-'))
  const scripts = [
    'build-mobile-icons',
    'prepare-pty',
    'build-mobile-terminal',
    'build-mobile-mermaid',
    'prepare-mobile-markdown',
    'build-browser-viewer',
    'build-mcp-apps',
  ]
  const log = join(directory, 'calls.jsonl')
  try {
    await copyFile(
      new URL('./postinstall.mjs', import.meta.url),
      join(directory, 'postinstall.mjs'),
    )
    for (const script of scripts) {
      await writeFile(
        join(directory, `${script}.mjs`),
        `
        import { appendFileSync } from 'node:fs'
        appendFileSync(process.env.TEST_INSTALL_LOG, JSON.stringify(${JSON.stringify(script)}) + '\\n')
        if (process.env.TEST_FAIL_SCRIPT === ${JSON.stringify(script)}) process.exit(1)
      `,
      )
    }
    const run = (target, fail = '') =>
      execFileSync(process.execPath, [join(directory, 'postinstall.mjs')], {
        env: {
          ...process.env,
          DOVO_BUILD_TARGET: target,
          TEST_INSTALL_LOG: log,
          TEST_FAIL_SCRIPT: fail,
        },
        stdio: 'pipe',
      })
    const calls = async () =>
      (await readFile(log, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    run('gpui')
    assert.deepEqual(await calls(), ['prepare-pty', 'build-browser-viewer', 'build-mcp-apps'])
    await writeFile(log, '')
    run('')
    assert.deepEqual(await calls(), scripts)
    await writeFile(log, '')
    run('all')
    assert.deepEqual(await calls(), scripts)
    await writeFile(log, '')
    assert.throws(() => run('unknown'), /Unknown build target/)
    assert.equal(await readFile(log, 'utf8'), '')
    assert.throws(() => run('gpui', 'prepare-pty'), /Command failed/)
    assert.deepEqual(await calls(), ['prepare-pty'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
