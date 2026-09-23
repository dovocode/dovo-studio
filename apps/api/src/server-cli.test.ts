import { expect, it } from 'vite-plus/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { setupServer, writePrivateJson } from './server-config'
it('runs doctor in the selected release so bundled SDK diagnostics do not use checkout versions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-release-doctor-'))
  try {
    setupServer(directory)
    const release = join(directory, 'releases', 'selected')
    mkdirSync(release, {
      recursive: true,
    })
    writeFileSync(join(release, 'index.js'), '')
    writeFileSync(
      join(release, 'server-cli.js'),
      "console.log(JSON.stringify({release:'selected',args:process.argv.slice(2)}))",
    )
    writePrivateJson(join(directory, 'server-release.json'), {
      entrypoint: join(release, 'index.js'),
    })
    const result = await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL('../dist/server-cli.js', import.meta.url)),
      'doctor',
      '--data-dir',
      directory,
      '--check-updates',
      '--json',
    ])
    expect(JSON.parse(result.stdout)).toEqual({
      release: 'selected',
      args: ['doctor', '--data-dir', directory, '--check-updates', '--json'],
    })
  } finally {
    rmSync(directory, {
      recursive: true,
      force: true,
    })
  }
})
it('keeps archive installs on their package version and directs updates to the package manager', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-package-update-'))
  try {
    const result = promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(new URL('../dist/server-cli.js', import.meta.url)),
        'update',
        '--data-dir',
        directory,
      ],
      {
        env: {
          ...process.env,
          DOVO_SERVER_DISTRIBUTION: 'archive',
        },
      },
    )
    await expect(result).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('managed by Homebrew, mise or an archive install'),
    })
  } finally {
    rmSync(directory, {
      recursive: true,
      force: true,
    })
  }
})
