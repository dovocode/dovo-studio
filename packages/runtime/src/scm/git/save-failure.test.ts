import { describe, expect, it, vi } from 'vite-plus/test'
import { spawn } from 'node:child_process'
import { chmod, link, mkdir, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fixture } from '../../testing/fixture'
import { runtimeIntegration } from '../../testing/integration'
import { GitService } from './git'

vi.setConfig(runtimeIntegration)

const original = 'o'.repeat(3000)
const replacement = 'n'.repeat(4000)

// The child saves through the actual Git service or the task editor's HTTP route. It prints the
// HTTP status, or the error code if the save fails without one.
// Node ignores SIGXFSZ, so a write past the limit fails with EFBIG. The runtime loads signal-exit
// through proper-lockfile, which turns the signal back into an exit. A listener keeps EFBIG, so the
// test can check the route's response.
const child = (git: string, runtime: string) => `
process.on('SIGXFSZ', () => {})
const [route, directory, workspace, name] = process.argv.slice(2)
const original = ${JSON.stringify(original)}
const contents = 'n'.repeat(${replacement.length})
if (route === 'git') {
  const { GitService } = await import(${JSON.stringify(git)})
  try {
    await new GitService().save(directory, name, original, contents)
    process.stdout.write('200')
  } catch (error) {
    process.stdout.write(String(error.status ?? error.code ?? error.message))
  }
} else {
  const { startRuntime } = await import(${JSON.stringify(runtime)})
  const ownerToken = 'save-limit-owner-token-at-least-32-characters'
  const server = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  try {
    server.services.store.update(() => JSON.parse(workspace))
    const task = server.services.tasks.create({
      title: 'Save failure',
      agentId: 'agent',
      repositoryId: 'repo',
      objective: '',
    })
    const response = await fetch('http://127.0.0.1:' + server.port + '/api/tasks/files/write', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + ownerToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, path: name, expectedContents: original, contents }),
    })
    process.stdout.write(String(response.status))
  } finally {
    await server.close()
  }
}
`

// /bin/sh counts this limit in 512 or 1024-byte blocks, below the 3,000-byte original either way.
const runChild = async (script: string, args: string[], limited: boolean) => {
  const running = spawn(
    '/bin/sh',
    [
      '-c',
      `${limited ? 'ulimit -f 2 && ' : ''}exec "$0" "$@"`,
      process.execPath,
      // Load workspace packages from source, as in the test process, rather than build output.
      '--conditions=development',
      '--import',
      createRequire(import.meta.url).resolve('tsx'),
      script,
      ...args,
    ],
    // tsx would otherwise write its compile cache under the same limit.
    { env: { ...process.env, TSX_DISABLE_CACHE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let stdout = '',
    stderr = ''
  running.stdout.on('data', (chunk: Buffer) => (stdout += chunk))
  running.stderr.on('data', (chunk: Buffer) => (stderr += chunk))
  const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) =>
    running.on('close', (...result) => resolve(result)),
  )
  return { code, signal, stdout, stderr }
}

type Layout = {
  name: string
  path: string
  limited: boolean
  status: string
  prepare: (file: string) => Promise<void>
  restore?: (file: string) => Promise<void>
}

const root = process.getuid?.() === 0
const layouts: Layout[] = [
  {
    name: 'an ordinary file at the file-size limit',
    path: 'ordinary.txt',
    limited: true,
    status: '507',
    prepare: async () => {},
  },
  {
    // A rename would separate the names, and an in-place write cannot be all-or-nothing.
    name: 'a hard-linked file',
    path: 'linked.txt',
    limited: false,
    status: '409',
    prepare: (file) => link(file, `${file}.second`),
  },
  {
    // A temporary file cannot be created, so the only option left would truncate the original.
    name: 'a writable file in a read-only folder at the file-size limit',
    path: 'locked/file.txt',
    limited: true,
    status: '403',
    prepare: (file) => chmod(dirname(file), 0o555),
    restore: (file) => chmod(dirname(file), 0o755),
  },
  {
    // A rename only needs write access to the folder. It must not bypass the file's own mode.
    name: 'a read-only file in a writable folder',
    path: 'readonly.txt',
    limited: false,
    status: '403',
    prepare: (file) => chmod(file, 0o444),
  },
]

describe.skipIf(process.platform === 'win32')('a failed save', () => {
  for (const route of ['git', 'editor'] as const)
    for (const layout of layouts)
      // Root ignores file and folder modes.
      it.skipIf(root && layout.status === '403')(
        `keeps ${layout.name} through the ${route} route`,
        async () => {
          const f = await fixture()
          const file = join(f.directory, layout.path)
          try {
            await writeFile(join(f.directory, '.git/info/exclude'), '.save-child.mts\n')
            await mkdir(dirname(file), { recursive: true })
            await writeFile(file, original)
            await layout.prepare(file)
            const before = await stat(file)
            const script = join(f.directory, '.save-child.mts')
            await writeFile(
              script,
              child(
                new URL('./git.ts', import.meta.url).href,
                new URL('../../index.ts', import.meta.url).href,
              ),
            )
            const result = await runChild(
              script,
              [route, f.directory, JSON.stringify(f.workspace), layout.path],
              layout.limited,
            )
            // stderr is part of the compared value, so a child that fails to load explains itself.
            expect({ status: result.stdout, stderr: result.stderr }).toMatchObject({
              status: layout.status,
            })
            const after = await stat(file)
            expect(await readFile(file, 'utf8')).toBe(original)
            expect({ ino: after.ino, nlink: after.nlink, mode: after.mode }).toEqual({
              ino: before.ino,
              nlink: before.nlink,
              mode: before.mode,
            })
            expect((await readdir(dirname(file))).filter((name) => name.endsWith('.tmp'))).toEqual(
              [],
            )
          } finally {
            await layout.restore?.(file)
            await f.cleanup()
          }
        },
      )
})

it.skipIf(process.platform === 'win32')(
  'keeps symlinks and permissions when a save replaces a file',
  async () => {
    const f = await fixture(),
      git = new GitService()
    try {
      const file = join(f.directory, 'hello.txt')
      await chmod(file, 0o640)
      await symlink('hello.txt', join(f.directory, 'alias.txt'))
      await git.save(f.directory, 'alias.txt', 'original\n', 'through link\n')
      expect((await stat(file)).mode & 0o777).toBe(0o640)
      expect(await readFile(file, 'utf8')).toBe('through link\n')
      expect(await readFile(join(f.directory, 'alias.txt'), 'utf8')).toBe('through link\n')

      await git.save(f.directory, 'new.txt', '', 'created\n')
      expect(await readFile(join(f.directory, 'new.txt'), 'utf8')).toBe('created\n')
      expect((await readdir(f.directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])
    } finally {
      await f.cleanup()
    }
  },
)
