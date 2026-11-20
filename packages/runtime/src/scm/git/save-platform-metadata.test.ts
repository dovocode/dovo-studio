import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, vi } from 'vite-plus/test'
import * as runtimeProcess from '../../process.js'
import { fixture } from '../../testing/fixture.js'
import { GitService } from './git.js'

const original = 'original\n'
const updated = 'saved\n'
const ordinaryModes =
  '-rw-r--r-- 1 501 20 9 Nov 20 10:30 first\n-rw-r--r-- 1 501 20 6 Nov 20 10:30 second\n'

it.each([
  { name: 'an ACL', modes: ordinaryModes.replace('-rw-r--r-- ', '-rw-r--r--+ ') },
  { name: 'a Finder tag', attributes: 'com.apple.metadata:_kMDItemUserTags\n' },
  { name: 'a file flag', flags: '32768\n0\n' },
])('refuses a macOS save that would drop $name', async ({ modes, attributes, flags }) => {
  const f = await fixture()
  const originalExec = runtimeProcess.exec
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  vi.spyOn(runtimeProcess, 'exec').mockImplementation(async (command, args, options) => {
    if (command === '/bin/ls') return { stdout: modes ?? ordinaryModes, stderr: '' }
    if (command === '/usr/bin/xattr') return { stdout: attributes ?? '', stderr: '' }
    if (command === '/usr/bin/stat') return { stdout: flags ?? '0\n0\n', stderr: '' }
    return originalExec(command, args, options)
  })
  try {
    await expect(
      new GitService().save(f.directory, 'hello.txt', original, updated),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('file attributes or access controls'),
    })
    expect(await readFile(join(f.directory, 'hello.txt'), 'utf8')).toBe(original)
  } finally {
    vi.restoreAllMocks()
    await f.cleanup()
  }
})

it('passes Windows file names as literal data and refuses a metadata mismatch', async () => {
  const f = await fixture()
  const name = "space and [brackets] '$.txt"
  const path = join(f.directory, name)
  const originalExec = runtimeProcess.exec
  try {
    await writeFile(path, original)
    const canonicalPath = await realpath(path)
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const check = vi
      .spyOn(runtimeProcess, 'exec')
      .mockImplementation(async (command, args, options) => {
        if (!command.endsWith('powershell.exe')) return originalExec(command, args, options)
        return { stdout: 'different\r\n', stderr: '' }
      })
    await expect(new GitService().save(f.directory, name, original, updated)).rejects.toMatchObject(
      {
        status: 409,
        message: expect.stringContaining('file attributes or access controls'),
      },
    )
    const call = check.mock.calls.find(([command]) => command.endsWith('powershell.exe'))
    expect(call?.[1]).toContain('-EncodedCommand')
    const script = Buffer.from(call?.[1]?.at(-1) ?? '', 'base64').toString('utf16le')
    expect(script).toContain('-LiteralPath $path')
    expect(script).not.toContain(name)
    expect(call?.[2]?.env?.DOVO_REPLACEMENT_TARGET).toBe(canonicalPath)
    expect(await readFile(path, 'utf8')).toBe(original)
  } finally {
    vi.restoreAllMocks()
    await f.cleanup()
  }
})

it.skipIf(process.platform !== 'win32')(
  'saves an ordinary file and refuses one with an NTFS data stream',
  async () => {
    const f = await fixture()
    const path = join(f.directory, 'hello.txt')
    const stream = path + ':dovo-test'
    const git = new GitService()
    try {
      await git.save(f.directory, 'hello.txt', original, updated)
      expect(await readFile(path, 'utf8')).toBe(updated)
      await writeFile(stream, 'metadata')
      await expect(git.save(f.directory, 'hello.txt', updated, original)).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('file attributes or access controls'),
      })
      expect(await readFile(path, 'utf8')).toBe(updated)
      expect(await readFile(stream, 'utf8')).toBe('metadata')
    } finally {
      await f.cleanup()
    }
  },
)
