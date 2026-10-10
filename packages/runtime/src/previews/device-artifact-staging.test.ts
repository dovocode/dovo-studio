import { afterEach, expect, it, vi } from 'vite-plus/test'
import * as fs from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { stageDeviceArtifact } from './device-artifact-staging'

vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
}))

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'dovo-staging-test-'))
  roots.push(root)
  return root
}

it('stages an independent APK and disposes its private directory idempotently', async () => {
  const root = await fixture()
  const source = join(root, 'build.apk')
  await fs.writeFile(source, 'apk bytes')
  const staged = await stageDeviceArtifact('build.apk', root)
  expect(staged.extension).toBe('.apk')
  expect(staged.directory).toBe(false)
  expect((await fs.stat(dirname(staged.file))).mode & 0o777).toBe(0o700)
  await fs.writeFile(source, 'new build')
  expect(await fs.readFile(staged.file, 'utf8')).toBe('apk bytes')
  await staged.dispose()
  await staged.dispose()
  await expect(fs.stat(dirname(staged.file))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('copies app directories and preserves executable permissions', async () => {
  const root = await fixture()
  await fs.mkdir(join(root, 'Build.app', 'Contents'), { recursive: true })
  await fs.writeFile(join(root, 'Build.app', 'Contents', 'run'), 'executable', { mode: 0o751 })
  const staged = await stageDeviceArtifact(join(root, 'Build.app'), root)
  try {
    expect(staged.directory).toBe(true)
    expect(staged.extension).toBe('.app')
    expect(await fs.readFile(join(staged.file, 'Contents', 'run'), 'utf8')).toBe('executable')
    expect((await fs.stat(join(staged.file, 'Contents', 'run'))).mode & 0o777).toBe(0o751)
  } finally {
    await staged.dispose()
  }
})

it('rejects source symlinks, ancestor symlinks, root escapes and internal bundle symlinks', async () => {
  const root = await fixture()
  const outside = await fixture()
  await fs.writeFile(join(outside, 'outside.apk'), 'secret')
  await fs.symlink(join(outside, 'outside.apk'), join(root, 'link.apk'))
  await fs.symlink(outside, join(root, 'ancestor'))
  await fs.mkdir(join(root, 'Build.app'))
  await fs.symlink(join(outside, 'outside.apk'), join(root, 'Build.app', 'link'))
  for (const path of [
    'link.apk',
    'ancestor/outside.apk',
    'Build.app',
    join(outside, 'outside.apk'),
  ])
    await expect(stageDeviceArtifact(path, root)).rejects.toThrow(/Artifact/)
})

it('removes staging after a copy failure', async () => {
  const root = await fixture()
  await fs.writeFile(join(root, 'build.apk'), 'apk')
  const create = vi.spyOn(fs, 'mkdtemp')
  const originalOpen = fs.open
  vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
    if (flags === 'wx') throw new Error('controlled write failure')
    return originalOpen(path, flags, mode)
  })
  await expect(stageDeviceArtifact('build.apk', root)).rejects.toThrow('controlled write failure')
  const staging = await create.mock.results[0]?.value
  expect(typeof staging).toBe('string')
  await expect(fs.stat(staging)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('rejects a source modified while its held descriptor is being copied and cleans up', async () => {
  const root = await fixture()
  const source = join(root, 'build.apk')
  await fs.writeFile(source, 'original build')
  const create = vi.spyOn(fs, 'mkdtemp')
  const originalOpen = fs.open
  vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
    const handle = await originalOpen(path, flags, mode)
    if (flags === 'wx') {
      const write = handle.write.bind(handle)
      vi.spyOn(handle, 'write').mockImplementationOnce(async (...args) => {
        await fs.writeFile(source, 'changed build with different size')
        return write(...args)
      })
    }
    return handle
  })
  await expect(stageDeviceArtifact('build.apk', root)).rejects.toThrow('Artifact changed')
  const staging = await create.mock.results[0]?.value
  await expect(fs.stat(staging)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('never reads external files when a directory ancestor is replaced during copying', async () => {
  const root = await fixture()
  const outside = await fixture()
  await fs.mkdir(join(root, 'Build.app'))
  await fs.writeFile(join(root, 'Build.app', 'first'), 'safe')
  await fs.writeFile(join(outside, 'second'), 'secret')
  const originalRead = fs.readdir
  let replaced = false
  vi.spyOn(fs, 'readdir').mockImplementation(async (...args) => {
    const result = await originalRead(...args)
    if (!replaced && String(args[0]).startsWith('/proc/self/fd/')) {
      replaced = true
      await fs.rename(join(root, 'Build.app'), join(root, 'old.app'))
      await fs.symlink(outside, join(root, 'Build.app'))
    }
    return result
  })
  await expect(stageDeviceArtifact('Build.app', root)).rejects.toThrow(/Artifact/)
})

it('stages bundles on hosts without Linux descriptor paths', async () => {
  const platform = process.platform
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  const directory = await fs.mkdtemp(join(tmpdir(), 'dovo-portable-stage-test-'))
  try {
    await fs.mkdir(join(directory, 'Example.app'))
    await fs.writeFile(join(directory, 'Example.app', 'app'), 'built-app')
    const artifact = await stageDeviceArtifact('Example.app', directory)
    try {
      expect(await fs.readFile(join(artifact.file, 'app'), 'utf8')).toBe('built-app')
    } finally {
      await artifact.dispose()
    }
  } finally {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
    await fs.rm(directory, { recursive: true, force: true })
  }
})

it('allows unrelated writes in checkout and ancestor directories while staging', async () => {
  const root = await fixture()
  await fs.mkdir(join(root, 'build'))
  await fs.writeFile(join(root, 'build', 'app.apk'), 'apk bytes')
  const originalOpen = fs.open
  vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
    if (flags === 'wx') {
      await fs.writeFile(join(root, 'unrelated'), 'root change')
      await fs.writeFile(join(root, 'build', 'unrelated'), 'ancestor change')
    }
    return originalOpen(path, flags, mode)
  })
  const staged = await stageDeviceArtifact('build/app.apk', root)
  try {
    expect(await fs.readFile(staged.file, 'utf8')).toBe('apk bytes')
  } finally {
    await staged.dispose()
  }
})

it('still rejects new files added inside the artifact bundle during copying', async () => {
  const root = await fixture()
  await fs.mkdir(join(root, 'Build.app'))
  await fs.writeFile(join(root, 'Build.app', 'binary'), 'built app')
  const originalOpen = fs.open
  vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
    if (flags === 'wx') await fs.writeFile(join(root, 'Build.app', 'added'), 'new content')
    return originalOpen(path, flags, mode)
  })
  await expect(stageDeviceArtifact('Build.app', root)).rejects.toThrow('Artifact changed')
})

it('still rejects ancestor permission changes during copying', async () => {
  const root = await fixture()
  await fs.mkdir(join(root, 'build'), { mode: 0o700 })
  await fs.writeFile(join(root, 'build', 'app.apk'), 'apk')
  const originalOpen = fs.open
  vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
    if (flags === 'wx') await fs.chmod(join(root, 'build'), 0o755)
    return originalOpen(path, flags, mode)
  })
  await expect(stageDeviceArtifact('build/app.apk', root)).rejects.toThrow('Artifact changed')
})
