import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  lstat,
  stat,
  symlink,
  unlink,
  readdir,
  rm,
  realpath,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  defaultTaskHarness,
  decode,
  harnessInstructionFilesSchema,
  harnessInstructionReadSchema,
} from '@dovo/protocol'
import { openDatabase } from '../../storage/database.js'
import { WorkspaceStore } from '../../storage/workspace.js'
import { AgentRegistry } from './registry.js'
import { HarnessInstructions } from './harness-instructions.js'
import { startRuntime } from '../../index.js'
import { runtimeIntegration } from '../../testing/integration.js'

vi.setConfig(runtimeIntegration)
let directory: string
const cleanups: Array<() => void | Promise<void>> = []
beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'dovo-harness-instructions-')))
  for (const [key, folder] of Object.entries({
    CODEX_HOME: 'codex',
    CLAUDE_CONFIG_DIR: 'claude',
    PI_CODING_AGENT_DIR: 'pi',
    XDG_CONFIG_HOME: 'config',
    COPILOT_HOME: 'copilot',
    HERMES_HOME: 'hermes',
  }))
    vi.stubEnv(key, join(directory, folder))
})
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})
function setup() {
  const db = openDatabase(':memory:')
  cleanups.push(() => {
    db.close()
  })
  const store = new WorkspaceStore(db)
  const registry = new AgentRegistry()
  cleanups.push(() => registry.dispose())
  return { store, files: new HarnessInstructions(store, registry) }
}
async function fileFor(files: HarnessInstructions, provider = 'codex', name = 'AGENTS.md') {
  const file = (await files.list()).files.find(
    (file) => file.provider === provider && file.name === name,
  )
  if (!file) throw Error('Missing test instruction file')
  return file
}
it('lists native filenames and resolves profile directories without creating or reading files', async () => {
  const { store, files } = setup()
  store.update((workspace) => ({
    ...workspace,
    agents: [
      {
        ...defaultTaskHarness('codex'),
        id: 'custom',
        name: 'Work Codex',
        configDirectory: join(directory, 'work'),
        env: { CODEX_HOME: join(directory, 'wrong') },
      },
      { ...defaultTaskHarness('claude'), id: 'default-claude', name: 'Personal Claude' },
      { ...defaultTaskHarness('cursor'), id: 'cursor', name: 'Cursor' },
    ],
  }))
  const list = await files.list()
  expect(list.notices).toEqual([])
  expect(list.files.map((file) => [file.provider, file.name])).toEqual(
    expect.arrayContaining([
      ['codex', 'AGENTS.md'],
      ['claude', 'CLAUDE.md'],
      ['pi', 'AGENTS.md'],
      ['opencode', 'AGENTS.md'],
      ['copilot', 'copilot-instructions.md'],
      ['hermes', 'SOUL.md'],
    ]),
  )
  expect(list.files.find((file) => file.profiles.includes('Work Codex'))?.path).toBe(
    join(directory, 'work', 'AGENTS.md'),
  )
  expect(list.files.find((file) => file.provider === 'claude')?.profiles).toContain(
    'Personal Claude',
  )
  expect(list.files.some((file) => file.provider === 'cursor')).toBe(false)
  expect(await readdir(directory)).toEqual([])
})
it('exposes existing overrides and Pi fallback context files', async () => {
  const { files } = setup()
  await mkdir(join(directory, 'codex'))
  await writeFile(join(directory, 'codex', 'AGENTS.override.md'), 'Override\n')
  await mkdir(join(directory, 'pi'))
  await writeFile(join(directory, 'pi', 'CLAUDE.md'), 'Pi context\n')
  expect((await fileFor(files, 'codex', 'AGENTS.override.md')).name).toBe('AGENTS.override.md')
  expect((await files.read(await fileFor(files, 'pi', 'CLAUDE.md'))).text).toBe('Pi context\n')
})
it('previews missing files without writes and creates only the selected file on save', async () => {
  const { files } = setup()
  const file = await fileFor(files)
  const current = await files.read(file)
  expect(current).toMatchObject({ text: '', exists: false, resolvedPath: file.path })
  const input = { ...file, version: current.version, text: 'Keep user work.\n' }
  expect(await files.preview(input)).toMatchObject({
    changed: true,
    diff: expect.stringContaining('+Keep user work.'),
  })
  expect(await readdir(directory)).toEqual([])
  const saved = await files.save(input)
  expect(await readFile(file.path, 'utf8')).toBe(input.text)
  expect(process.platform === 'win32' ? undefined : (await stat(file.path)).mode & 0o777).toBe(
    process.platform === 'win32' ? undefined : 0o600,
  )
  expect((await files.read(file)).version).toBe(saved.version)
  expect(await readdir(join(directory, 'codex'))).toEqual(['AGENTS.md'])
})
it('rejects disk conflicts and allows an explicit reload and review', async () => {
  const { files } = setup()
  const file = await fileFor(files)
  await mkdir(dirname(file.path), { recursive: true })
  await writeFile(file.path, 'Original\n')
  const current = await files.read(file)
  const input = { ...file, version: current.version, text: 'My draft\n' }
  await files.preview(input)
  await writeFile(file.path, 'External editor\n')
  await expect(files.preview(input)).rejects.toMatchObject({ status: 409 })
  await expect(files.save(input)).rejects.toMatchObject({ status: 409 })
  expect(await readFile(file.path, 'utf8')).toBe('External editor\n')
  const reloaded = await files.read(file)
  await files.preview({ ...input, version: reloaded.version })
  await files.save({ ...input, version: reloaded.version })
  expect(await readFile(file.path, 'utf8')).toBe(input.text)
})
it('serializes concurrent saves without losing the first accepted edit', async () => {
  const { files } = setup()
  const file = await fileFor(files)
  const current = await files.read(file)
  const results = await Promise.allSettled(
    ['One\n', 'Two\n'].map((text) => files.save({ ...file, text, version: current.version })),
  )
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  expect(['One\n', 'Two\n']).toContain(await readFile(file.path, 'utf8'))
  expect(await readdir(join(directory, 'codex'))).toEqual(['AGENTS.md'])
})
it.each(['bad\0text', 'bad\ud800text'])(
  'rejects non-text drafts without creating a file: %j',
  async (text) => {
    const { files } = setup()
    const file = await fileFor(files)
    const current = await files.read(file)
    const input = { ...file, text, version: current.version }
    await expect(files.preview(input)).rejects.toMatchObject({ status: 415 })
    await expect(files.save(input)).rejects.toMatchObject({ status: 415 })
    expect(await readdir(directory)).toEqual([])
  },
)
it('preserves a dotfile symlink and its target permissions', async () => {
  const { files } = setup()
  const file = await fileFor(files)
  await mkdir(join(directory, 'codex'))
  const target = join(directory, 'shared.md')
  await writeFile(target, 'Shared\n', { mode: 0o640 })
  await symlink(target, file.path)
  const current = await files.read(file)
  expect(current.resolvedPath).toBe(target)
  await files.save({ ...file, version: current.version, text: 'Updated shared\n' })
  expect((await lstat(file.path)).isSymbolicLink()).toBe(true)
  expect(await readFile(target, 'utf8')).toBe('Updated shared\n')
  expect(process.platform === 'win32' ? undefined : (await stat(target)).mode & 0o777).toBe(
    process.platform === 'win32' ? undefined : 0o640,
  )
})
it('rejects repointed and dangling symlinks without replacing either file', async () => {
  const { files } = setup()
  const file = await fileFor(files)
  await mkdir(join(directory, 'codex'))
  const first = join(directory, 'first.md'),
    second = join(directory, 'second.md')
  await writeFile(first, 'Same text\n')
  await writeFile(second, 'Same text\n')
  await symlink(first, file.path)
  const current = await files.read(file)
  await unlink(file.path)
  await symlink(second, file.path)
  await expect(
    files.save({ ...file, version: current.version, text: 'Draft' }),
  ).rejects.toMatchObject({ status: 409 })
  expect(await readFile(second, 'utf8')).toBe('Same text\n')
  await unlink(file.path)
  await symlink(join(directory, 'missing.md'), file.path)
  await expect(files.read(file)).rejects.toMatchObject({ status: 409 })
  expect((await lstat(file.path)).isSymbolicLink()).toBe(true)
})
it('rejects stale configuration IDs, binary files, oversized files and directories', async () => {
  const { files } = setup()
  const file = await fileFor(files)
  await mkdir(join(directory, 'codex'))
  await writeFile(file.path, 'bad\0text')
  await expect(files.read(file)).rejects.toMatchObject({ status: 415 })
  await writeFile(file.path, Buffer.from([0xff]))
  await expect(files.read(file)).rejects.toMatchObject({ status: 415 })
  await writeFile(file.path, 'a'.repeat(200001))
  await expect(files.read(file)).rejects.toMatchObject({ status: 413 })
  await unlink(file.path)
  await mkdir(file.path)
  await expect(files.read(file)).rejects.toMatchObject({ status: 400 })
  vi.stubEnv('CODEX_HOME', join(directory, 'other-codex'))
  await expect(files.read(file)).rejects.toMatchObject({ status: 409 })
  await expect(files.read({ id: '../../secret' })).rejects.toMatchObject({ status: 409 })
})
it('reports relative configuration directories instead of guessing a working directory', async () => {
  const { files } = setup()
  vi.stubEnv('CODEX_HOME', 'relative-codex')
  expect((await files.list()).notices).toEqual(
    expect.arrayContaining([expect.stringContaining('absolute harness configuration directory')]),
  )
})
it('uses authenticated HTTP, advertises support and blocks agent-scoped callers', async () => {
  const token = 'harness-instructions-test-owner-token-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  const post = (operation: string, input: unknown, credential = token, agent = false) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/agents/instructions/${operation}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential}`,
        'Content-Type': 'application/json',
        ...(agent ? { 'X-Dovo-Agent-Access': '1' } : {}),
      },
      body: JSON.stringify(input),
    })
  expect((await post('list', {}, 'invalid')).status).toBe(401)
  expect((await post('list', {}, token, true)).status).toBe(403)
  const list = decode(harnessInstructionFilesSchema, await (await post('list', {})).json())
  const file = list.files.find((file) => file.provider === 'codex')
  if (!file) throw new Error('Missing Codex instruction file')
  const current = decode(
    harnessInstructionReadSchema,
    await (await post('read', { id: file.id })).json(),
  )
  expect(
    (await post('preview', { id: file.id, version: current.version, text: 'HTTP edit\n' })).status,
  ).toBe(200)
  expect(
    (await post('save', { id: file.id, version: current.version, text: 'HTTP edit\n' })).status,
  ).toBe(200)
  expect(await readFile(file.path, 'utf8')).toBe('HTTP edit\n')
  const snapshot = await fetch(`http://127.0.0.1:${runtime.port}/api/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(await snapshot.json()).toMatchObject({ harnessInstructionsSupported: true })
})
