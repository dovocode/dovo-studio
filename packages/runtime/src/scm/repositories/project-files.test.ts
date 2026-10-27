import { expect, it, vi } from 'vite-plus/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitService } from '../git/git'
import { ProjectFiles } from './project-files'

it('refreshes a folder immediately while ordinary reads retain the cached listing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-project-files-'))
  const files = new ProjectFiles(new GitService())
  try {
    await writeFile(join(directory, 'before.txt'), '')
    expect(await files.all(directory, true)).toEqual(['before.txt'])
    await rm(join(directory, 'before.txt'))
    await writeFile(join(directory, 'after.txt'), '')
    expect(await files.all(directory, true)).toEqual(['before.txt'])
    expect(await files.all(directory, true, true)).toEqual(['after.txt'])
    expect(await files.search(directory, 'after', 8, true)).toEqual(['after.txt'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('keeps a refreshed Git listing when an older in-flight listing finishes', async () => {
  const git = new GitService()
  let resolve!: (value: string) => void
  const older = new Promise<string>((done) => {
    resolve = done
  })
  const command = vi.spyOn(git, 'command').mockReturnValueOnce(older)
  command.mockResolvedValueOnce('new.txt\0')
  const files = new ProjectFiles(git)
  const pending = files.all('/checkout')
  expect(await files.all('/checkout', false, true)).toEqual(['new.txt'])
  resolve('old.txt\0')
  expect(await pending).toEqual(['old.txt'])
  expect(await files.all('/checkout')).toEqual(['new.txt'])
  expect(command).toHaveBeenCalledTimes(2)
})

it('does not evict a refreshed listing when the older read fails', async () => {
  const git = new GitService()
  let reject!: (reason: Error) => void
  const older = new Promise<string>((_resolve, fail) => {
    reject = fail
  })
  const command = vi.spyOn(git, 'command').mockReturnValueOnce(older)
  command.mockResolvedValueOnce('new.txt\0')
  const files = new ProjectFiles(git)
  const failure = new Error('old failure')
  const pending = files.all('/checkout').then(
    () => ({ error: undefined }),
    (error: unknown) => ({ error }),
  )
  expect(await files.all('/checkout', false, true)).toEqual(['new.txt'])
  reject(failure)
  expect((await pending).error).toBe(failure)
  expect(await files.all('/checkout')).toEqual(['new.txt'])
  expect(command).toHaveBeenCalledTimes(2)
})

it('allows retrying a failed refresh without reusing its rejected promise', async () => {
  const git = new GitService()
  const command = vi.spyOn(git, 'command').mockResolvedValueOnce('old.txt\0')
  command.mockRejectedValueOnce(new Error('refresh failed')).mockResolvedValueOnce('new.txt\0')
  const files = new ProjectFiles(git)
  await files.all('/checkout')
  await expect(files.all('/checkout', false, true)).rejects.toThrow('refresh failed')
  expect(await files.all('/checkout')).toEqual(['new.txt'])
  expect(command).toHaveBeenCalledTimes(3)
})
