import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'
import { archiveTool } from './archive-tool.mjs'

void test('Windows uses its native ZIP-capable tar independently of Git Bash PATH', () => {
  assert.equal(archiveTool('win32', 'D:\\Windows'), 'D:\\Windows\\System32\\tar.exe')
  assert.equal(archiveTool('linux'), 'tar')
  assert.equal(archiveTool('darwin'), 'tar')
})

void test('release archives round-trip absolute paths with spaces and preserve file contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dovo archive '))
  try {
    const source = join(root, 'source files'),
      shadow = join(root, 'git tools')
    await Promise.all([source, shadow].map((path) => mkdir(path)))
    await writeFile(join(source, 'test file.txt'), 'Dovo archive contents\n')
    // A PATH-selected tar.exe would fail. The native Windows tool must still succeed.
    await writeFile(join(shadow, 'tar.exe'), 'This is not a Windows executable')
    const windows = process.platform === 'win32'
    const options = { env: { ...process.env, PATH: shadow + delimiter + process.env.PATH } }
    for (const format of windows ? ['tar.gz', 'zip'] : ['tar.gz']) {
      const archive = join(root, `release.${format}`),
        destination = join(root, `extracted ${format}`)
      await mkdir(destination)
      execFileSync(
        archiveTool(),
        [format === 'zip' ? '-acf' : '-czf', archive, '-C', source, '.'],
        options,
      )
      if (format === 'zip')
        assert.equal((await readFile(archive)).subarray(0, 4).toString('hex'), '504b0304')
      execFileSync(
        archiveTool(),
        [format === 'zip' ? '-xf' : '-xzf', archive, '-C', destination],
        options,
      )
      assert.equal(
        await readFile(join(destination, 'test file.txt'), 'utf8'),
        'Dovo archive contents\n',
      )
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
