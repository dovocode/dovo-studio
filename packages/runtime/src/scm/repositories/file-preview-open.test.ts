import { afterEach, expect, it, vi } from 'vite-plus/test'
import { constants } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, symlink, rename, rm, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openContainedPreview } from './file-preview-open.js'

vi.mock('node:fs/promises', { spy: true })
const cleanup: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const directory of cleanup.splice(0)) await rm(directory, { recursive: true, force: true })
})

it('keeps final nofollow protection when a canonical target becomes a symlink before open', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-preview-open-'))
  cleanup.push(directory)
  const target = join(directory, 'target.txt')
  await writeFile(target, 'safe')
  await symlink('target.txt', join(directory, 'alias.txt'))
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(open).mockImplementationOnce(async (path, flags, mode) => {
    expect(path).toBe(target)
    expect(Number(flags) & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW)
    await rename(target, join(directory, 'old.txt'))
    await symlink('old.txt', target)
    return fs.open(path, flags, mode)
  })
  await expect(openContainedPreview(directory, 'alias.txt')).rejects.toMatchObject({
    code: 'ELOOP',
  })
})

it('closes the descriptor and rejects regular target replacement after open', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-preview-replacement-'))
  cleanup.push(directory)
  const target = join(directory, 'target.txt')
  await writeFile(target, 'safe')
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  let opened: Awaited<ReturnType<typeof open>> | undefined
  vi.mocked(open).mockImplementationOnce(async (path, flags, mode) => {
    opened = await fs.open(path, flags, mode)
    await rename(target, join(directory, 'old.txt'))
    await writeFile(target, 'replacement')
    return opened
  })
  await expect(openContainedPreview(directory, 'target.txt')).rejects.toMatchObject({ status: 409 })
  expect(opened?.fd).toBe(-1)
})

it('closes the descriptor if a canonical parent is redirected outside during open', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-preview-parent-'))
  const outside = await mkdtemp(join(tmpdir(), 'dovo-preview-private-'))
  cleanup.push(directory, outside)
  await mkdir(join(directory, 'src'))
  await writeFile(join(directory, 'src', 'target.txt'), 'safe')
  await writeFile(join(outside, 'target.txt'), 'private')
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  let opened: Awaited<ReturnType<typeof open>> | undefined
  vi.mocked(open).mockImplementationOnce(async (path, flags, mode) => {
    await rename(join(directory, 'src'), join(directory, 'old'))
    await symlink(outside, join(directory, 'src'))
    opened = await fs.open(path, flags, mode)
    return opened
  })
  await expect(openContainedPreview(directory, 'src/target.txt')).rejects.toMatchObject({
    status: 400,
  })
  expect(opened?.fd).toBe(-1)
})

it.skipIf(process.platform === 'win32')(
  'rejects and closes a FIFO swapped in between lstat and open without waiting for a writer',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dovo-preview-fifo-'))
    cleanup.push(directory)
    const target = join(directory, 'target.txt')
    await writeFile(target, 'safe')
    const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    let opened: Awaited<ReturnType<typeof open>> | undefined
    vi.mocked(open).mockImplementationOnce(async (path, flags, mode) => {
      // Fail before the real open if this regresses, rather than leaving a blocked libuv worker.
      expect(Number(flags) & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK)
      expect(Number(flags) & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW)
      await rename(target, join(directory, 'old.txt'))
      execFileSync('mkfifo', [target])
      opened = await fs.open(path, flags, mode)
      expect((await opened.stat()).isFIFO()).toBe(true)
      return opened
    })
    await expect(openContainedPreview(directory, 'target.txt')).rejects.toMatchObject({
      status: 409,
    })
    expect(opened?.fd).toBe(-1)
  },
)
