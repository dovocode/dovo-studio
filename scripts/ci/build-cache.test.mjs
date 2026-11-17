import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const { parse } = createRequire(new URL('../../packages/runtime/package.json', import.meta.url))(
  'yaml',
)
const action = parse(
  await readFile(new URL('../../.github/actions/setup-build/action.yml', import.meta.url), 'utf8'),
)
const script = action.runs.steps.find((step) => step.id === 'downloads').run

for (const scenario of [
  { name: 'preserves a store path with spaces', path: '/cache/pnpm store/v11', status: 0 },
  { name: 'propagates pnpm failure', path: '', status: 37, error: 'pnpm bootstrap failed' },
  { name: 'rejects an empty store path', path: '', status: 0 },
]) {
  await test(
    `build cache setup ${scenario.name}`,
    { skip: process.platform === 'win32' },
    async (t) => {
      const directory = await mkdtemp(join(tmpdir(), 'dovo-build-cache-'))
      t.after(() => rm(directory, { recursive: true, force: true }))
      const bin = join(directory, 'bin')
      const output = join(directory, 'output')
      await mkdir(bin)
      // Keep native-cache setup out of this test. Exercise the actual action shell
      // with controlled pnpm output and the same error flags as GitHub Actions.
      await writeFile(join(bin, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      await writeFile(
        join(bin, 'pnpm'),
        '#!/bin/sh\nprintf "%s" "$DOVO_TEST_STORE"\nprintf "%s" "$DOVO_TEST_ERROR" >&2\nexit "$DOVO_TEST_STATUS"\n',
        { mode: 0o755 },
      )
      await writeFile(output, '')
      const result = spawnSync(
        'bash',
        ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            GITHUB_WORKSPACE: directory,
            GITHUB_OUTPUT: output,
            DOVO_TEST_STORE: scenario.path,
            DOVO_TEST_STATUS: String(scenario.status),
            DOVO_TEST_ERROR: scenario.error ?? '',
          },
          timeout: 10000,
        },
      )
      assert.ifError(result.error)
      const written = await readFile(output, 'utf8')
      if (scenario.path) {
        assert.equal(result.status, 0, result.stderr)
        assert.equal(written, `store=${scenario.path}\n`)
      } else {
        assert.notEqual(result.status, 0, 'Setup must fail before cache restore')
        assert.equal(written, '', 'Do not publish an empty cache path')
        if (scenario.error) {
          assert.equal(result.status, scenario.status)
          assert.match(result.stderr, /pnpm bootstrap failed/)
        } else assert.match(result.stdout, /pnpm store path returned no path/)
      }
    },
  )
}
