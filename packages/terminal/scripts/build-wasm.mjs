import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Normal app builds consume the checked-in WASM; rebuilding requires Zig 0.15.2.
const revision = '5714ed07a1012573261b7b7e3ed2add9c1504496'
const archiveHash = '55cee28558945de6e984bc183cd51f28eefdbf805544da2e70d4635476178790'
const root = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'dovo-terminal-wasm-'))
const run = (command, args, cwd = temporary) =>
  execFileSync(command, args, { cwd, stdio: 'inherit' })
try {
  const archive = join(temporary, 'ghostty.tar.gz')
  run('curl', [
    '--fail',
    '--location',
    '--silent',
    '--show-error',
    `https://codeload.github.com/ghostty-org/ghostty/tar.gz/${revision}`,
    '--output',
    archive,
  ])
  if (
    createHash('sha256')
      .update(await readFile(archive))
      .digest('hex') !== archiveHash
  )
    throw new Error('Ghostty source archive checksum mismatch')
  run('tar', ['-xf', archive])
  const source = join(temporary, `ghostty-${revision}`)
  for (const patch of ['ghostty-wasm-api.patch', 'history-wrap.patch', 'wasm-zero-pages.patch'])
    run('git', ['apply', '--whitespace=nowarn', join(root, 'vendor', patch)], source)
  run(
    process.env.ZIG ?? 'zig',
    ['build', 'lib-vt', '-Dtarget=wasm32-freestanding', '-Doptimize=ReleaseSmall'],
    source,
  )
  await copyFile(
    join(source, 'zig-out/bin/ghostty-vt.wasm'),
    join(root, 'src/browser/assets/ghostty-vt.wasm'),
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
