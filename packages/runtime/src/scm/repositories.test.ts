import { decode } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, readFile, realpath, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { repositorySchema } from '@dovo/protocol'
import { fixture } from '../testing/fixture.js'
import { GitService } from './git.js'
import { startRuntime } from '../index.js'
import { addRepository } from './repositories.js'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
it('registers the exact Git folder selected when its name ends in whitespace', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const path = join(await realpath(f.directory), 'Project ')
  await mkdir(path)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: randomBytes(32).toString('base64url'),
    port: 0,
  })
  cleanups.push(() => runtime.close())
  await runtime.services.git.command(path, ['init', '-q'])
  const repository = await addRepository(runtime.services, {
    source: 'local',
    name: 'Project',
    path,
  })
  expect(repository.path).toBe(path)
  expect(runtime.services.store.get().repositories[0]?.path).toBe(path)
})
it.each([undefined, 'work-account'])(
  'uses the clone parent and the selected GitHub profile (%s) for forge clones',
  async (cliProfile) => {
    const f = await fixture()
    cleanups.push(f.cleanup)
    const parent = await realpath(f.directory)
    const runtime = await startRuntime({
      databasePath: ':memory:',
      ownerToken: randomBytes(32).toString('base64url'),
      port: 0,
    })
    cleanups.push(() => runtime.close())
    const s = runtime.services
    const connection = s.forges.save({
      name: 'GitHub',
      provider: 'github',
      baseUrl: 'https://github.com',
      credential: 'gh',
      cliProfile,
    })
    const adapter = s.pulls.adapter(connection.id, 'owner/project', parent)
    const remote = {
      id: 'project',
      name: 'project',
      fullName: 'owner/project',
      url: 'https://github.com/owner/project',
      cloneUrl: 'https://github.com/owner/project.git',
    }
    vi.spyOn(adapter, 'repository').mockResolvedValue(remote)
    const metadata = vi.spyOn(s.pulls, 'adapter').mockReturnValue(adapter)
    const auth = vi.spyOn(s.forges, 'gitAuthorization').mockResolvedValue('Basic fixture-token')
    const clone = vi.spyOn(s.git, 'cloneRemote').mockResolvedValue({
      path: join(parent, 'project'),
      branch: 'main',
    })
    const input = {
      source: 'forge',
      name: 'Project',
      directory: f.directory,
      forge: {
        connectionId: connection.id,
        repository: 'owner/project',
      },
    }
    await expect(
      addRepository(s, {
        ...input,
        directory: join(parent, 'missing'),
      }),
    ).rejects.toThrow('existing clone parent')
    expect(metadata).not.toHaveBeenCalled()
    expect(auth).not.toHaveBeenCalled()
    await addRepository(s, input)
    expect(metadata).toHaveBeenCalledWith(connection.id, 'owner/project', parent)
    expect(auth.mock.calls).toEqual(cliProfile ? [[connection.id, remote.cloneUrl, parent]] : [])
    expect(clone).toHaveBeenCalledWith(
      remote,
      parent,
      cliProfile ? 'Basic fixture-token' : undefined,
      !cliProfile,
    )
  },
)
it('clones a real repository, detects its branch, and never overwrites a destination', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const git = new GitService()
  const repository = {
    name: 'download',
    url: f.directory,
  }
  const result = await git.cloneGithub(repository, f.directory)
  expect(result).toEqual({
    path: join(await realpath(f.directory), 'download'),
    branch: (await git.inspect(f.directory)).branch,
  })
  expect(await readFile(join(result.path, 'hello.txt'), 'utf8')).toBe('original\n')
  await expect(git.cloneGithub(repository, f.directory)).rejects.toThrow(
    'Destination already exists',
  )
  expect(await readFile(join(result.path, 'hello.txt'), 'utf8')).toBe('original\n')
  await symlink(f.directory, join(f.directory, 'linked'))
  await expect(
    git.cloneGithub(
      {
        ...repository,
        name: 'linked',
      },
      f.directory,
    ),
  ).rejects.toThrow('Destination already exists')
})
it('reports failed clones with a recovery path and keeps existing files intact', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const git = new GitService()
  await expect(
    git.cloneGithub(
      {
        name: 'failed',
        url: join(f.directory, 'missing'),
      },
      f.directory,
    ),
  ).rejects.toThrow('downloaded files may remain')
  expect(await readFile(join(f.directory, 'hello.txt'), 'utf8')).toBe('original\n')
})
it('authenticates and validates repository additions, deduplicates local paths, and persists clones', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: token,
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const call = (input: unknown, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/scm/repositories/add`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    })
  const input = {
    source: 'local',
    name: 'Local',
    path: f.directory,
  }
  expect((await call(input, 'invalid')).status).toBe(401)
  expect(runtime.services.store.get().repositories).toHaveLength(0)
  const response = await call(input)
  expect(response.status).toBe(200)
  const local = decode(repositorySchema, await response.json())
  expect(local.path).toBe(await realpath(f.directory))
  expect(local.branch).toBe((await runtime.services.git.inspect(f.directory)).branch)
  expect(decode(repositorySchema, await (await call(input)).json()).id).toBe(local.id)
  expect(runtime.services.store.get().repositories).toHaveLength(1)
  const empty = join(f.directory, 'empty')
  await mkdir(empty)
  expect(
    (
      await call({
        ...input,
        path: join(f.directory, 'missing'),
      })
    ).status,
  ).toBe(400)
  const clone = runtime.services.git.cloneGithub.bind(runtime.services.git)
  const spy = vi
    .spyOn(runtime.services.git, 'cloneGithub')
    .mockImplementation((repository, directory) =>
      clone(
        {
          ...repository,
          url: f.directory,
        },
        directory,
      ),
    )
  const github = {
    source: 'github',
    name: 'Downloaded',
    repository: 'https://github.com/owner/project.git',
    directory: empty,
  }
  expect(
    (
      await call({
        ...github,
        repository: 'https://evil.test/owner/project',
      })
    ).status,
  ).toBe(400)
  expect(spy).not.toHaveBeenCalled()
  const downloaded = await call(github)
  expect(downloaded.status).toBe(200)
  const added = decode(repositorySchema, await downloaded.json())
  expect(spy).toHaveBeenCalledWith(
    {
      name: 'project',
      url: 'https://github.com/owner/project.git',
    },
    empty,
  )
  expect(await readFile(join(added.path, 'hello.txt'), 'utf8')).toBe('original\n')
  expect(runtime.services.store.get().repositories).toEqual([local, added])
  expect((await call(github)).status).toBe(409)
  expect(runtime.services.store.get().repositories).toHaveLength(2)
})
