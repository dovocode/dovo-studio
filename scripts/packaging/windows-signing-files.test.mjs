import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { windowsSigningFiles } from './windows-signing-files.mjs'

await test('selects Windows PE binaries while preserving foreign native prebuilds', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-signing-files-'))
  try {
    await mkdir(join(directory, 'prebuilds'))
    const pe = Buffer.alloc(132)
    pe.writeUInt16LE(0x5a4d)
    pe.writeUInt32LE(128, 0x3c)
    pe.write('PE\0\0', 128, 'binary')
    for (const name of ['app.exe', 'library.dll', 'prebuilds/windows.node', 'ignore.txt'])
      await writeFile(join(directory, name), pe)
    await writeFile(join(directory, 'prebuilds/linux.node'), Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    await writeFile(join(directory, 'prebuilds/darwin.node'), Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))
    const invalid = Buffer.from(pe)
    invalid.write('NOPE', 128)
    await writeFile(join(directory, 'prebuilds/invalid.node'), invalid)
    assert.deepEqual(await windowsSigningFiles(directory), [
      join(directory, 'app.exe'),
      join(directory, 'library.dll'),
      join(directory, 'prebuilds/windows.node'),
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
