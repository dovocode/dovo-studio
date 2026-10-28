import { expect, it, vi } from 'vite-plus/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitService } from '../git/git'
import { ProjectFiles } from './project-files'

it('refreshes a folder immediately while ordinary reads retain the cached listing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-project-files-'))
  const files = new ProjectFiles(new GitService())
  try {
    await writeFile(join(directory, 'before.txt'), '')
    expect(await files.all(directory, true)).toEqual({ files: ['before.txt'], truncated: false })
    await rm(join(directory, 'before.txt'))
    await writeFile(join(directory, 'after.txt'), '')
    expect(await files.all(directory, true)).toEqual({ files: ['before.txt'], truncated: false })
    expect(await files.all(directory, true, true)).toEqual({
      files: ['after.txt'],
      truncated: false,
    })
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
  expect(await files.all('/checkout', false, true)).toEqual({
    files: ['new.txt'],
    truncated: false,
  })
  resolve('old.txt\0')
  expect(await pending).toEqual({ files: ['old.txt'], truncated: false })
  expect(await files.all('/checkout')).toEqual({ files: ['new.txt'], truncated: false })
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
  expect(await files.all('/checkout', false, true)).toEqual({
    files: ['new.txt'],
    truncated: false,
  })
  reject(failure)
  expect((await pending).error).toBe(failure)
  expect(await files.all('/checkout')).toEqual({ files: ['new.txt'], truncated: false })
  expect(command).toHaveBeenCalledTimes(2)
})

it('allows retrying a failed refresh without reusing its rejected promise', async () => {
  const git = new GitService()
  const command = vi.spyOn(git, 'command').mockResolvedValueOnce('old.txt\0')
  command.mockRejectedValueOnce(new Error('refresh failed')).mockResolvedValueOnce('new.txt\0')
  const files = new ProjectFiles(git)
  await files.all('/checkout')
  await expect(files.all('/checkout', false, true)).rejects.toThrow('refresh failed')
  expect(await files.all('/checkout')).toEqual({ files: ['new.txt'], truncated: false })
  expect(command).toHaveBeenCalledTimes(3)
})

it('reports Git omissions only beyond the unique file limit and preserves command errors', async () => {
  const git = new GitService()
  const command = vi.spyOn(git, 'command')
  const paths = Array.from({ length: 200_000 }, (_, index) => `file-${index}`)
  command
    .mockResolvedValueOnce(`${paths.join('\0')}\0${paths[0]}\0`)
    .mockResolvedValueOnce(`${paths.join('\0')}\0extra\0`)
    .mockRejectedValueOnce(new Error('maxBuffer exceeded'))
  const files = new ProjectFiles(git)
  expect(await files.all('/checkout')).toEqual({ files: paths, truncated: false })
  expect(await files.all('/checkout', false, true)).toEqual({ files: paths, truncated: true })
  await expect(files.all('/checkout', false, true)).rejects.toThrow('maxBuffer exceeded')
})

it('reports depth omissions only when a skipped directory contains a listable file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-project-files-depth-'))
  const deep = join(directory, ...Array.from({ length: 50 }, () => 'd'))
  const files = new ProjectFiles(new GitService())
  try {
    await mkdir(deep, { recursive: true })
    expect(await files.all(directory, true)).toEqual({ files: [], truncated: false })
    await writeFile(join(deep, 'hidden.txt'), '')
    expect(await files.all(directory, true, true)).toEqual({ files: [], truncated: true })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('leaves completeness unknown when probing skipped directories exceeds its budget', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-project-files-probe-'))
  const deep = join(directory, ...Array.from({ length: 50 }, () => 'd'))
  const files = new ProjectFiles(new GitService())
  try {
    await mkdir(deep, { recursive: true })
    await Promise.all(Array.from({ length: 1_000 }, (_, index) => mkdir(join(deep, `d${index}`))))
    expect(await files.all(directory, true)).toEqual({ files: [] })
    await writeFile(join(deep, 'hidden.txt'), '')
    expect(await files.all(directory, true, true)).toEqual({ files: [], truncated: true })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
