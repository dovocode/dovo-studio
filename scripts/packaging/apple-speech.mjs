import { execFileSync } from 'node:child_process'
import { renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export function prepareAppleSpeech(root, bundle) {
  if (process.platform !== 'darwin') return false
  const sdk = execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-version'], {
    encoding: 'utf8',
  })
  if (Number(sdk.split('.')[0]) < 26) return false
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
  const output = join(bundle, 'dovo-apple-speech')
  const temporary = `${output}.${process.pid}.tmp`
  try {
    execFileSync(
      'xcrun',
      [
        '--sdk',
        'macosx',
        'swiftc',
        '-parse-as-library',
        '-swift-version',
        '5',
        '-O',
        '-target',
        `${arch}-apple-macos26.0`,
        join(root, 'apps/desktop/native/apple-speech.swift'),
        '-o',
        temporary,
      ],
      { stdio: 'inherit' },
    )
    renameSync(temporary, output)
    return true
  } finally {
    rmSync(temporary, { force: true })
  }
}
