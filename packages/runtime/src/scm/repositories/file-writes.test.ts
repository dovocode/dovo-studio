import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { execFileSync, spawnSync } from 'node:child_process'
import type { FileHandle } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as processTools from '../../process'
import { replaceFileContents } from './file-writes'

// Faults reach cases that a test account cannot create on a real disk: another owner, a rename
// that Windows refuses, or a change by another program at an exact moment. Every other file
// operation is real.
const faults = vi.hoisted(() => ({
  beforeTemporarySync: undefined as (() => Promise<void>) | undefined,
  chown: undefined as NodeJS.ErrnoException | undefined,
  rename: undefined as NodeJS.ErrnoException | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const temporary = (handle: FileHandle) =>
    new Proxy(handle, {
      get(target, key) {
        if (key === 'sync')
          return async () => {
            await faults.beforeTemporarySync?.()
            return target.sync()
          }
        if (key === 'stat' && faults.chown)
          return async () => {
            const info = await target.stat()
            info.gid += 1
            return info
          }
        if (key === 'chown' && faults.chown)
          return async () => {
            throw faults.chown
          }
        const value: unknown = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      return args[1] === 'wx' ? temporary(handle) : handle
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (faults.rename) throw faults.rename
      return actual.rename(...args)
    },
  }
})

const failure = (code: string) => Object.assign(new Error(`${code}: test fault`), { code })
const original = 'o'.repeat(3000)
const posix = process.platform !== 'win32'
const installed = (tool: string) =>
  process.platform === 'linux' && spawnSync(tool, ['--version']).error === undefined
let directory = ''

beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'dovo-file-writes-'))
})
afterEach(async () => {
  faults.beforeTemporarySync = faults.chown = faults.rename = undefined
  vi.restoreAllMocks()
  await fs.rm(directory, { recursive: true, force: true })
})

const readAcl = (path: string) =>
  execFileSync('getfacl', ['--absolute-names', '--omit-header', '--numeric', '--', path], {
    encoding: 'utf8',
  })

const leftovers = async () => (await fs.readdir(directory)).filter((name) => name.endsWith('.tmp'))

it.skipIf(!posix)('keeps the mode of an existing file, including setuid', async () => {
  const file = join(directory, 'file.txt')
  await fs.writeFile(file, original)
  await fs.chmod(file, 0o4750)

  await replaceFileContents(file, 'saved\n')
  expect(await fs.readFile(file, 'utf8')).toBe('saved\n')
  expect((await fs.stat(file)).mode & 0o7777).toBe(0o4750)
  expect(await leftovers()).toEqual([])
})

it.skipIf(!posix)('gives a new file the same mode as any other new file', async () => {
  // writeFile creates with 0o666 minus the process umask.
  await fs.writeFile(join(directory, 'reference.txt'), '')
  const file = join(directory, 'new.txt')

  await replaceFileContents(file, 'created\n')
  expect(await fs.readFile(file, 'utf8')).toBe('created\n')
  expect((await fs.stat(file)).mode).toBe((await fs.stat(join(directory, 'reference.txt'))).mode)
})

it.skipIf(!posix)('refuses to separate hard links', async () => {
  const file = join(directory, 'file.txt'),
    second = join(directory, 'second.txt')
  await fs.writeFile(file, original)
  await fs.link(file, second)
  const before = await fs.stat(file)

  await expect(replaceFileContents(file, 'n'.repeat(4000))).rejects.toMatchObject({
    status: 409,
    message: expect.stringContaining('other hard links'),
  })
  const after = await fs.stat(file)
  expect({ ino: after.ino, nlink: after.nlink }).toEqual({ ino: before.ino, nlink: 2 })
  expect(await fs.readFile(second, 'utf8')).toBe(original)
  expect(await leftovers()).toEqual([])
})

it.skipIf(!posix)('refuses a save that would change the file owner', async () => {
  const file = join(directory, 'file.txt')
  await fs.writeFile(file, original)
  // The temporary file inherited a different group, and the account cannot change it.
  faults.chown = failure('EPERM')

  await expect(replaceFileContents(file, 'n'.repeat(4000))).rejects.toMatchObject({
    status: 409,
    message: expect.stringContaining('owner or group'),
  })
  expect(await fs.readFile(file, 'utf8')).toBe(original)
  expect(await leftovers()).toEqual([])
})

it('refuses a save when the system will not replace the file', async () => {
  const file = join(directory, 'file.txt')
  await fs.writeFile(file, original)
  faults.rename = failure('EBUSY')

  await expect(replaceFileContents(file, 'n'.repeat(4000))).rejects.toMatchObject({
    status: 409,
    message: expect.stringContaining('Close other programs'),
  })
  expect(await fs.readFile(file, 'utf8')).toBe(original)
  expect(await leftovers()).toEqual([])
})

it('refuses to replace a file that another program replaced during the save', async () => {
  const file = join(directory, 'file.txt')
  await fs.writeFile(file, original)
  faults.beforeTemporarySync = async () => {
    faults.beforeTemporarySync = undefined
    // An external editor saves its own temporary file over the original.
    await fs.writeFile(join(directory, 'external'), 'external\n')
    await fs.rename(join(directory, 'external'), file)
  }

  await expect(replaceFileContents(file, 'n'.repeat(4000))).rejects.toMatchObject({
    status: 409,
  })
  expect(await fs.readFile(file, 'utf8')).toBe('external\n')
  expect(await leftovers()).toEqual([])
})

it.skipIf(!posix)('refuses to replace a file whose mode changed during the save', async () => {
  const file = join(directory, 'file.txt')
  await fs.writeFile(file, original)
  await fs.chmod(file, 0o644)
  faults.beforeTemporarySync = async () => {
    faults.beforeTemporarySync = undefined
    await fs.chmod(file, 0o600)
  }

  await expect(replaceFileContents(file, 'n'.repeat(4000))).rejects.toMatchObject({
    status: 409,
  })
  expect(await fs.readFile(file, 'utf8')).toBe(original)
  expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
  expect(await leftovers()).toEqual([])
})

it('refuses to replace a file created during the save', async () => {
  const file = join(directory, 'new.txt')
  faults.beforeTemporarySync = async () => {
    faults.beforeTemporarySync = undefined
    await fs.writeFile(file, 'external\n')
  }

  await expect(replaceFileContents(file, 'created\n')).rejects.toMatchObject({ status: 409 })
  expect(await fs.readFile(file, 'utf8')).toBe('external\n')
  expect(await leftovers()).toEqual([])
})

it.skipIf(!installed('setfacl'))('keeps an explicit access control list', async () => {
  const file = join(directory, 'file.txt')
  await fs.writeFile(file, original)
  execFileSync('setfacl', ['-m', 'u:65534:r', file])
  const before = readAcl(file)
  expect(before).toContain('user:65534:r--')

  await replaceFileContents(file, 'saved\n')
  expect(await fs.readFile(file, 'utf8')).toBe('saved\n')
  expect(readAcl(file)).toBe(before)
  expect(await leftovers()).toEqual([])
})

it.skipIf(!installed('setfacl'))('saves a file whose folder ACL the copy inherits', async () => {
  execFileSync('setfacl', ['-d', '-m', 'u:65534:r', directory])
  const file = join(directory, 'file.txt')
  await fs.writeFile(file, original)
  const before = readAcl(file)
  expect(before).toContain('user:65534:r--')

  await replaceFileContents(file, 'saved\n')
  expect(await fs.readFile(file, 'utf8')).toBe('saved\n')
  expect(readAcl(file)).toBe(before)
})

it.skipIf(!installed('python3'))('preserves a binary user attribute without getfattr', async () => {
  const file = join(directory, 'file.txt')
  await fs.writeFile(file, original)
  const python = execFileSync('python3', ['-I', '-c', 'import sys; print(sys.executable)'], {
    encoding: 'utf8',
  }).trim()
  const args = ['-I', '-c']
  execFileSync(python, [
    ...args,
    "import os,sys; os.setxattr(sys.argv[1], 'user.dovo', bytes(range(256)))",
    file,
  ])
  vi.stubEnv('PATH', directory)
  try {
    await replaceFileContents(file, 'saved\n')
    expect(await fs.readFile(file, 'utf8')).toBe('saved\n')
    const attribute = execFileSync(python, [
      ...args,
      "import os,sys; sys.stdout.buffer.write(os.getxattr(sys.argv[1], 'user.dovo'))",
      file,
    ])
    expect(attribute.equals(Buffer.from(Array.from({ length: 256 }, (_, i) => i)))).toBe(true)
    expect(await leftovers()).toEqual([])
  } finally {
    vi.unstubAllEnvs()
  }
})

it.skipIf(process.platform !== 'linux')(
  'keeps the original when the metadata copier is unavailable',
  async () => {
    const file = join(directory, 'file.txt')
    await fs.writeFile(file, original)
    const before = await fs.stat(file)
    vi.spyOn(processTools, 'exec').mockRejectedValueOnce(failure('ENOENT'))
    await expect(replaceFileContents(file, 'replacement')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('The file was not changed'),
    })
    expect((await fs.stat(file)).ino).toBe(before.ino)
    expect(await fs.readFile(file, 'utf8')).toBe(original)
    expect(await leftovers()).toEqual([])
  },
)
