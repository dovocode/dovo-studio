import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { configureApt, usePrimaryUbuntuMirror } from './linux-apt.mjs'

await test('bounds apt downloads and changes only the Azure Ubuntu mirror in both source formats', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-apt-'))
  try {
    await mkdir(join(directory, 'apt.conf.d'))
    await mkdir(join(directory, 'sources.list.d'))
    const legacy =
      'deb [signed-by=/ubuntu-keyring.gpg] http://azure.archive.ubuntu.com/ubuntu noble main\n'
    const modern =
      'Types: deb\nURIs: https://azure.archive.ubuntu.com/ubuntu/\nSuites: noble-updates\nSigned-By: /ubuntu-keyring.gpg\n'
    const ports = 'deb http://ports.ubuntu.com/ubuntu-ports noble main\n'
    await writeFile(join(directory, 'sources.list'), legacy)
    await writeFile(join(directory, 'sources.list.d/ubuntu.sources'), modern)
    await writeFile(join(directory, 'sources.list.d/ports.list'), ports)
    await writeFile(join(directory, 'sources.list.d/ubuntu.sources.backup'), modern)
    await configureApt(directory)
    assert.match(
      await readFile(join(directory, 'apt.conf.d/99dovo-ci'), 'utf8'),
      /Acquire::http::Timeout "30"/,
    )
    assert.equal(await usePrimaryUbuntuMirror(directory), 2)
    assert.equal(
      await readFile(join(directory, 'sources.list'), 'utf8'),
      legacy.replace('azure.archive', 'archive'),
    )
    assert.equal(
      await readFile(join(directory, 'sources.list.d/ubuntu.sources'), 'utf8'),
      modern.replace('azure.archive', 'archive'),
    )
    assert.equal(await readFile(join(directory, 'sources.list.d/ports.list'), 'utf8'), ports)
    assert.equal(
      await readFile(join(directory, 'sources.list.d/ubuntu.sources.backup'), 'utf8'),
      modern,
    )
    assert.equal(await usePrimaryUbuntuMirror(directory), 0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

await test('browser setup recovers interrupted dpkg and propagates recovery and fallback failures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-browser-install-'))
  try {
    const bin = join(directory, 'bin')
    await mkdir(bin)
    await writeFile(
      join(bin, 'timeout'),
      '#!/bin/sh\nprintf "%s\\n" "$1 $2" >> "$DOVO_TIMEOUT_LOG"\nshift 2\nexec "$@"\n',
      { mode: 0o755 },
    )
    await writeFile(
      join(bin, 'sudo'),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DOVO_FALLBACK_LOG"\nif [ "$1" = dpkg ]; then exit "$DOVO_DPKG_STATUS"; fi\n',
      {
        mode: 0o755,
      },
    )
    await writeFile(
      join(bin, 'pnpm'),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DOVO_INSTALL_LOG"\nif [ "$(wc -l < "$DOVO_INSTALL_LOG")" -eq 1 ]; then exit "$DOVO_FIRST_STATUS"; fi\nexit "$DOVO_SECOND_STATUS"\n',
      { mode: 0o755 },
    )
    for (const [first, dpkg, second, expected] of [
      [0, 0, 0, 0],
      [1, 0, 0, 0],
      [124, 0, 2, 2],
      [124, 1, 0, 1],
    ]) {
      const install = join(directory, `install-${first}-${dpkg}-${second}`)
      const fallback = join(directory, `fallback-${first}-${dpkg}-${second}`)
      const timeout = join(directory, `timeout-${first}-${dpkg}-${second}`)
      const result = spawnSync('bash', ['scripts/ci/install-browser.sh'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          DOVO_INSTALL_LOG: install,
          DOVO_FALLBACK_LOG: fallback,
          DOVO_TIMEOUT_LOG: timeout,
          DOVO_DPKG_STATUS: String(dpkg),
          DOVO_FIRST_STATUS: String(first),
          DOVO_SECOND_STATUS: String(second),
        },
      })
      assert.equal(result.status, expected, result.stderr)
      const retried = first !== 0 && dpkg === 0
      const attempts = retried ? 2 : 1
      assert.deepEqual(
        (await readFile(install, 'utf8')).trim().split('\n'),
        Array(attempts).fill('--filter @dovo/runtime exec playwright install --with-deps chromium'),
      )
      assert.deepEqual(
        (await readFile(timeout, 'utf8')).trim().split('\n'),
        first === 0
          ? ['--kill-after=10s 240']
          : [
              '--kill-after=10s 240',
              '--kill-after=10s 120',
              ...(retried ? ['--kill-after=10s 240'] : []),
            ],
      )
      if (first)
        assert.deepEqual((await readFile(fallback, 'utf8')).trim().split('\n'), [
          'dpkg --configure -a',
          ...(retried ? ['node scripts/ci/linux-apt.mjs fallback'] : []),
        ])
      else await assert.rejects(readFile(fallback), { code: 'ENOENT' })
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
