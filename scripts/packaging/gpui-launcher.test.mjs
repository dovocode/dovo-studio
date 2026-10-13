import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { desktopEntry, registerLinux } from '../../apps/desktop-gpui/packaging/install-linux.mjs'

test('Linux launcher handles literal special paths, updates its registration and retains application data', async (context) => {
  if (process.platform !== 'linux' || spawnSync('gio', ['help']).error)
    return context.skip('Requires Linux GIO')
  const temporary = await mkdtemp(join(tmpdir(), 'dovo-gpui-launcher-test-'))
  try {
    const packageDirectory = join(temporary, 'Dovo "quote" $cash `tick` %name \\folder')
    const dataHome = join(temporary, 'private-data')
    await mkdir(packageDirectory)
    await mkdir(dataHome)
    const output = join(packageDirectory, 'launched')
    await writeFile(
      join(packageDirectory, 'dovo-desktop-gpui'),
      '#!/bin/sh\nprintf started > "$(dirname "$0")/launched"\n',
      { mode: 0o755 },
    )
    await writeFile(join(packageDirectory, 'dovo-gpui.png'), 'fixture icon')
    await writeFile(join(dataHome, 'retained-app-data'), 'saved drafts')
    const desktop = await registerLinux({ packageDirectory, dataHome })
    assert.match(await readFile(desktop, 'utf8'), /X-Dovo-GPUI=true/)
    execFileSync('gio', ['launch', desktop], { env: { ...process.env, XDG_DATA_HOME: dataHome } })
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      try {
        await access(output)
        break
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    assert.equal(await readFile(output, 'utf8'), 'started')
    await registerLinux({ packageDirectory, dataHome })
    await registerLinux({ packageDirectory, dataHome, uninstall: true })
    await assert.rejects(access(desktop))
    assert.equal(await readFile(join(dataHome, 'retained-app-data'), 'utf8'), 'saved drafts')
    await registerLinux({ packageDirectory, dataHome, uninstall: true })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
test('Linux launcher preserves unknown entries and rejects invalid paths', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'dovo-gpui-launcher-unknown-'))
  try {
    const dataHome = join(temporary, 'data')
    const desktop = join(dataHome, 'applications/dev.dovo.studio.gpui.desktop')
    await mkdir(join(dataHome, 'applications'), { recursive: true })
    await writeFile(desktop, 'Unknown entry')
    await assert.rejects(
      registerLinux({ packageDirectory: temporary, dataHome }),
      /unrecognized launcher/,
    )
    await assert.rejects(
      registerLinux({ packageDirectory: temporary, dataHome, uninstall: true }),
      /unrecognized launcher/,
    )
    assert.equal(await readFile(desktop, 'utf8'), 'Unknown entry')
    assert.throws(() => desktopEntry('/path/with\nnewline'), /line breaks/)
    await assert.rejects(
      registerLinux({ packageDirectory: temporary, dataHome: 'relative' }),
      /must be absolute/,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
