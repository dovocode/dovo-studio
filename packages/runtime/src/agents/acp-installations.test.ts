import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as tar from 'tar'
import { AcpInstallations } from './acp-installations.js'
import { openDatabase } from '../storage/database.js'

const registryEntry = {
  id: 'test-agent',
  name: 'Test Agent',
  version: '1.2.3',
  description: 'A test agent',
  distribution: {
    binary: {
      'linux-x86_64': {
        archive: 'https://example.test/test-agent.tar.gz',
        sha256: '',
        cmd: 'agent',
        args: ['--stdio'],
        env: { TEST_SETTING: 'present' },
      },
    },
  },
}
const execFileAsync = promisify(execFile)
const inputUrl = (input: RequestInfo | URL) =>
  input instanceof Request ? input.url : input.toString()

function maliciousTar(path: string, type: 'file' | 'symlink') {
  const header = Buffer.alloc(512)
  header.write(path, 0, 100, 'utf8')
  header.write('0000700\0', 100, 8, 'ascii')
  header.write('0000000\0', 108, 8, 'ascii')
  header.write('0000000\0', 116, 8, 'ascii')
  header.write('00000000000\0', 124, 12, 'ascii')
  header.write('00000000000\0', 136, 12, 'ascii')
  header.fill(0x20, 148, 156)
  header[156] = type === 'symlink' ? '2'.charCodeAt(0) : '0'.charCodeAt(0)
  if (type === 'symlink') header.write('../outside', 157, 100, 'utf8')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  let checksum = 0
  for (const byte of header) checksum += byte
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  return gzipSync(Buffer.concat([header, Buffer.alloc(1024)]))
}

describe('ACP registry installations', () => {
  it('downloads, validates, installs, persists and removes a binary agent', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'dovo-acp-test-'))
    const fixture = join(temp, 'fixture')
    const archive = join(temp, 'agent.tar.gz')
    const installDirectory = join(temp, 'installed')
    const db = openDatabase(':memory:')
    const executableText = '#!/bin/sh\necho agent-ready\n'
    try {
      await writeFile(fixture, executableText, { mode: 0o700 })
      await tar.c({ cwd: temp, file: archive, gzip: true }, ['fixture'])
      const archiveBytes = await readFile(archive)
      const entry = structuredClone(registryEntry)
      entry.distribution.binary['linux-x86_64'].sha256 = createHash('sha256')
        .update(archiveBytes)
        .digest('hex')
      entry.distribution.binary['linux-x86_64'].cmd = 'fixture'
      const fetcher: typeof fetch = async (input) => {
        if (inputUrl(input).endsWith('/registry.json'))
          return Response.json({ version: '1.0.0', agents: [entry, { invalid: true }] })
        return new Response(archiveBytes)
      }
      const installer = new AcpInstallations(db, installDirectory, {
        fetch: fetcher,
        platform: 'linux',
        arch: 'x64',
      })
      const registry = await installer.registry()
      expect(registry.agents.map((agent) => agent.id)).toEqual(['test-agent'])
      const installation = await installer.install('test-agent')
      expect(installation.version).toBe('1.2.3')
      const launch = installer.launch('test-agent')
      expect(launch.args).toEqual(['--stdio'])
      expect(launch.env).toEqual({ TEST_SETTING: 'present' })
      expect(await readFile(launch.command, 'utf8')).toBe(executableText)
      const executed = await execFileAsync(launch.command, launch.args, {
        env: { ...process.env, ...launch.env },
      })
      expect(executed.stdout).toContain('agent-ready')

      const restored = new AcpInstallations(db, installDirectory, {
        fetch: fetcher,
        platform: 'linux',
        arch: 'x64',
      })
      expect(restored.list()).toEqual([installation])
      await restored.remove('test-agent')
      expect(restored.list()).toEqual([])
      expect(() => restored.launch('test-agent')).toThrow(/not installed/)
      await installer.dispose()
      await restored.dispose()
    } finally {
      db.close()
      await rm(temp, { recursive: true, force: true })
    }
  })

  it('keeps the current immutable installation when an update fails validation', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'dovo-acp-rollback-'))
    const fixture = join(temp, 'fixture')
    const archive = join(temp, 'agent.tar.gz')
    const db = openDatabase(':memory:')
    try {
      await writeFile(fixture, '#!/bin/sh\necho preserved\n', { mode: 0o700 })
      await tar.c({ cwd: temp, file: archive, gzip: true }, ['fixture'])
      const archiveBytes = await readFile(archive)
      const entry = structuredClone(registryEntry)
      entry.distribution.binary['linux-x86_64'].cmd = 'fixture'
      entry.distribution.binary['linux-x86_64'].sha256 = createHash('sha256')
        .update(archiveBytes)
        .digest('hex')
      const fetcher: typeof fetch = async (input) =>
        inputUrl(input).endsWith('/registry.json')
          ? Response.json({ version: '1.0.0', agents: [entry] })
          : new Response(archiveBytes)
      const installer = new AcpInstallations(db, join(temp, 'installed'), {
        fetch: fetcher,
        platform: 'linux',
        arch: 'x64',
      })
      await installer.install(entry.id)
      const oldLaunch = installer.launch(entry.id)
      const oldContent = await readFile(oldLaunch.command, 'utf8')
      entry.version = '1.2.4'
      entry.distribution.binary['linux-x86_64'].sha256 = '0'.repeat(64)
      await expect(installer.install(entry.id)).rejects.toThrow(/checksum/)
      expect(installer.list()[0]?.version).toBe('1.2.3')
      expect(await readFile(oldLaunch.command, 'utf8')).toBe(oldContent)
      await installer.dispose()
    } finally {
      db.close()
      await rm(temp, { recursive: true, force: true })
    }
  })

  it('refuses a stale database path outside its managed root and reinstalls safely', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'dovo-acp-stale-'))
    const fixture = join(temp, 'fixture')
    const archive = join(temp, 'agent.tar.gz')
    const installDirectory = join(temp, 'managed')
    const outsideDirectory = join(temp, 'outside')
    const outsideCommand = join(outsideDirectory, 'do-not-delete')
    const outsideContent = 'preserve this file'
    const db = openDatabase(':memory:')
    try {
      await mkdir(outsideDirectory, { recursive: true })
      await writeFile(outsideCommand, outsideContent)
      await writeFile(fixture, '#!/bin/sh\necho repaired\n', { mode: 0o700 })
      await tar.c({ cwd: temp, file: archive, gzip: true }, ['fixture'])
      const archiveBytes = await readFile(archive)
      const entry = structuredClone(registryEntry)
      entry.distribution.binary['linux-x86_64'].cmd = 'fixture'
      entry.distribution.binary['linux-x86_64'].sha256 = createHash('sha256')
        .update(archiveBytes)
        .digest('hex')
      const fetcher: typeof fetch = async (input) =>
        inputUrl(input).endsWith('/registry.json')
          ? Response.json({ version: '1.0.0', agents: [entry] })
          : new Response(archiveBytes)
      const installer = new AcpInstallations(db, installDirectory, {
        fetch: fetcher,
        platform: 'linux',
        arch: 'x64',
      })
      const publicInstallation = await installer.install(entry.id)
      await installer.dispose()
      db.prepare('UPDATE documents SET value = ? WHERE id = ?').run(
        JSON.stringify([
          {
            ...publicInstallation,
            command: outsideCommand,
            args: [],
            env: {},
            installPath: outsideDirectory,
            metadataPath: join(outsideDirectory, 'registry-entry.json'),
          },
        ]),
        'acp-installations',
      )

      const restored = new AcpInstallations(db, installDirectory, {
        fetch: fetcher,
        platform: 'linux',
        arch: 'x64',
      })
      expect(() => restored.launch(entry.id)).toThrow(/outside the managed directory/)
      await expect(restored.remove(entry.id)).rejects.toThrow(/outside the managed directory/)
      expect(await readFile(outsideCommand, 'utf8')).toBe(outsideContent)

      await restored.install(entry.id)
      expect(restored.launch(entry.id).command).toContain(installDirectory)
      expect(await readFile(outsideCommand, 'utf8')).toBe(outsideContent)
      await restored.dispose()
    } finally {
      db.close()
      await rm(temp, { recursive: true, force: true })
    }
  })

  it('installs an npm package under its immutable directory and launches the declared bin', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'dovo-acp-npm-'))
    const db = openDatabase(':memory:')
    const packageName = `dovo-acp-test-${Date.now()}`
    const packageDirectory = join(temp, 'fixture', 'package')
    const packageArchive = join(temp, 'fixture.tgz')
    let server: ReturnType<typeof createServer> | undefined
    try {
      await mkdir(packageDirectory, { recursive: true })
      await writeFile(
        join(packageDirectory, 'package.json'),
        JSON.stringify({
          name: packageName,
          version: '1.0.0',
          bin: { [packageName]: 'bin.js', alias: 'bin.js' },
        }),
      )
      await writeFile(
        join(packageDirectory, 'bin.js'),
        '#!/usr/bin/env node\nconsole.log("npm-agent-ready")\n',
      )
      await chmod(join(packageDirectory, 'bin.js'), 0o755)
      await tar.c({ cwd: join(temp, 'fixture'), file: packageArchive, gzip: true }, ['package'])
      const packageBytes = await readFile(packageArchive)
      let registryUrl = ''
      server = createServer((request, response) => {
        if (request.url === `/${packageName}`) {
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(
            JSON.stringify({
              name: packageName,
              'dist-tags': { latest: '1.0.0' },
              versions: {
                '1.0.0': {
                  name: packageName,
                  version: '1.0.0',
                  bin: { [packageName]: 'bin.js', alias: 'bin.js' },
                  dist: {
                    tarball: `${registryUrl}/package.tgz`,
                    shasum: createHash('sha1').update(packageBytes).digest('hex'),
                  },
                },
              },
            }),
          )
        } else if (request.url === '/package.tgz') {
          response.writeHead(200, { 'content-type': 'application/octet-stream' })
          response.end(packageBytes)
        } else {
          response.writeHead(404)
          response.end()
        }
      })
      await new Promise<void>((resolvePromise, reject) => {
        server!.once('error', reject)
        server!.listen(0, '127.0.0.1', () => resolvePromise())
      })
      const address = server.address()
      if (!address || typeof address === 'string')
        throw new Error('Could not start npm test registry')
      registryUrl = `http://127.0.0.1:${address.port}`
      const entry = {
        id: 'npm-agent',
        name: 'NPM Agent',
        version: '1.0.0',
        description: 'NPM agent',
        distribution: { npx: { package: `${packageName}@1.0.0`, args: ['--stdio'] } },
      }
      const installer = new AcpInstallations(db, join(temp, 'installed'), {
        fetch: async () => Response.json({ version: '1.0.0', agents: [entry] }),
        runCommand: (command, args, options) =>
          execFileAsync(command, args, {
            env: { ...options?.env, npm_config_registry: registryUrl },
            timeout: options?.timeout,
          }),
      })
      const installed = await installer.install(entry.id)
      const launch = installer.launch(entry.id)
      expect(launch.command).toContain(`/node_modules/${packageName}/bin.js`)
      expect(launch.args).toEqual(['--stdio'])
      const executed = await execFileAsync(launch.command, launch.args, {
        env: { ...process.env, ...launch.env },
      })
      expect(executed.stdout).toContain('npm-agent-ready')

      const installPath = dirname(dirname(dirname(dirname(launch.command))))
      db.prepare('UPDATE documents SET value = ? WHERE id = ?').run(
        JSON.stringify([
          {
            ...installed,
            command: 'node',
            args: [launch.command, ...launch.args],
            env: launch.env,
            installPath,
            metadataPath: join(installPath, 'registry-entry.json'),
          },
        ]),
        'acp-installations',
      )
      const windowsInstaller = new AcpInstallations(db, join(temp, 'installed'), {
        fetch: async () => Response.json({ version: '1.0.0', agents: [entry] }),
        platform: 'win32',
        arch: 'x64',
      })
      await windowsInstaller.install(entry.id)
      const windowsLaunch = windowsInstaller.launch(entry.id)
      expect(windowsLaunch.command).toBe('node')
      expect(windowsLaunch.args[0]).toBe(launch.command)
      const windowsExecuted = await execFileAsync(windowsLaunch.command, windowsLaunch.args, {
        env: { ...process.env, ...windowsLaunch.env },
      })
      expect(windowsExecuted.stdout).toContain('npm-agent-ready')
      await windowsInstaller.dispose()
      await installer.dispose()
    } finally {
      if (server?.listening)
        await new Promise<void>((resolvePromise, reject) =>
          server!.close((error) => (error ? reject(error) : resolvePromise())),
        )
      db.close()
      await rm(temp, { recursive: true, force: true })
    }
  })

  it('serializes mutations per id and keeps multiple installations independent', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'dovo-acp-lock-'))
    const db = openDatabase(':memory:')
    try {
      const entries = ['first-agent', 'second-agent'].map((id) => ({
        id,
        name: id,
        version: '1.0.0',
        description: id,
        distribution: { npx: { package: `${id}@1.0.0` } },
      }))
      let registryRequests = 0
      let packageInstalls = 0
      const installer = new AcpInstallations(db, join(temp, 'installed'), {
        fetch: async () => {
          registryRequests++
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 10))
          return Response.json({ version: '1.0.0', agents: entries })
        },
        runCommand: async (_command, args) => {
          packageInstalls++
          const spec = args.at(-1)!
          const packageName = spec.slice(0, spec.lastIndexOf('@'))
          const prefix = args[args.indexOf('--prefix') + 1]!
          const packageRoot = join(prefix, 'node_modules', packageName)
          await mkdir(packageRoot, { recursive: true })
          await writeFile(
            join(packageRoot, 'package.json'),
            JSON.stringify({ bin: `${packageName}.js` }),
          )
          await writeFile(join(packageRoot, `${packageName}.js`), '#!/usr/bin/env node\n')
          await chmod(join(packageRoot, `${packageName}.js`), 0o700)
          return { stdout: '', stderr: '' }
        },
      })
      const firstInstall = installer.install('first-agent')
      await expect(installer.install('first-agent')).rejects.toThrow(/already being changed/)
      const secondInstall = installer.install('second-agent')
      await expect(Promise.all([firstInstall, secondInstall])).resolves.toHaveLength(2)
      expect(registryRequests).toBe(2)
      expect(packageInstalls).toBe(2)
      expect(
        installer
          .list()
          .map(({ id }) => id)
          .sort(),
      ).toEqual(['first-agent', 'second-agent'])
      expect(installer.launch('first-agent').command).not.toBe(
        installer.launch('second-agent').command,
      )
      await installer.dispose()
    } finally {
      db.close()
      await rm(temp, { recursive: true, force: true })
    }
  })

  it('keeps uv tool bins versioned and launches the installed executable', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'dovo-acp-uv-'))
    const db = openDatabase(':memory:')
    try {
      const entry = {
        id: 'uv-agent',
        name: 'UV Agent',
        version: '0.10.1',
        description: 'UV agent',
        distribution: { uvx: { package: 'fast-agent-acp@0.10.1' } },
      }
      let installedBinDirectory = ''
      const installer = new AcpInstallations(db, join(temp, 'installed'), {
        fetch: async () => Response.json({ version: '1.0.0', agents: [entry] }),
        runCommand: async (_command, args, options) => {
          expect(args).toEqual(['tool', 'install', '--quiet', 'fast-agent-acp==0.10.1'])
          installedBinDirectory = options?.env?.UV_TOOL_BIN_DIR ?? ''
          const toolDirectory = options?.env?.UV_TOOL_DIR ?? ''
          expect(toolDirectory).toContain('/tools')
          await mkdir(installedBinDirectory, { recursive: true })
          const bin = join(installedBinDirectory, 'fast-agent-acp')
          const target = join(toolDirectory, 'fast-agent-acp-0.10.1', 'bin')
          await mkdir(dirname(target), { recursive: true })
          await writeFile(target, '#!/bin/sh\necho uv-agent-ready\n')
          await chmod(target, 0o700)
          if (process.platform === 'win32') await writeFile(bin, '#!/bin/sh\necho uv-agent-ready\n')
          else await symlink(target, bin)
          return { stdout: '', stderr: '' }
        },
      })
      await installer.install(entry.id)
      const launch = installer.launch(entry.id)
      expect(launch.command).toBe(join(installedBinDirectory, 'fast-agent-acp'))
      expect((await execFileAsync(launch.command, launch.args)).stdout).toContain('uv-agent-ready')
      await installer.dispose()
    } finally {
      db.close()
      await rm(temp, { recursive: true, force: true })
    }
  })

  it('bounds streamed registry responses even when content-length is missing', async () => {
    const db = openDatabase(':memory:')
    const installer = new AcpInstallations(db, undefined, {
      fetch: async () => {
        let sent = false
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!sent) {
                sent = true
                controller.enqueue(new Uint8Array(8 * 1024 * 1024))
              } else {
                controller.enqueue(new Uint8Array([0]))
                controller.close()
              }
            },
          }),
        )
      },
    })
    try {
      await expect(installer.registry()).rejects.toThrow(/too large/)
    } finally {
      await installer.dispose()
      db.close()
    }
  })

  it('rejects archive traversal and symbolic links', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'dovo-acp-path-'))
    const db = openDatabase(':memory:')
    try {
      for (const [caseId, archiveBytes] of [
        ['traversal', maliciousTar('../escape', 'file')],
        ['symlink', maliciousTar('agent-link', 'symlink')],
      ] as const) {
        const entry = structuredClone(registryEntry)
        entry.id = `test-${caseId}`
        entry.distribution.binary['linux-x86_64'].archive = 'https://example.test/agent.tar.gz'
        entry.distribution.binary['linux-x86_64'].cmd = 'agent'
        entry.distribution.binary['linux-x86_64'].sha256 = createHash('sha256')
          .update(archiveBytes)
          .digest('hex')
        const installer = new AcpInstallations(db, join(temp, `installed-${caseId}`), {
          fetch: async (input) =>
            inputUrl(input).endsWith('/registry.json')
              ? Response.json({ version: '1.0.0', agents: [entry] })
              : new Response(archiveBytes),
          platform: 'linux',
          arch: 'x64',
        })
        await expect(installer.install(entry.id)).rejects.toThrow(
          /unsafe path|symbolic link|unsupported entry/,
        )
        await expect(readFile(join(temp, 'escape'))).rejects.toThrow(/ENOENT/)
        expect(installer.list()).toEqual([])
        await installer.dispose()
      }
    } finally {
      db.close()
      await rm(temp, { recursive: true, force: true })
    }
  })
})

it('preserves executable ZIP helpers without granting special or public permissions', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dovo-acp-zip-'))
  const db = openDatabase(':memory:')
  const bytes = await readFile(
    new URL('../testing/fixtures/acp-helpers.zip.fixture', import.meta.url),
  )
  const entry = structuredClone(registryEntry)
  entry.distribution.binary['linux-x86_64'].archive = 'https://example.test/agent.zip'
  entry.distribution.binary['linux-x86_64'].sha256 = createHash('sha256')
    .update(bytes)
    .digest('hex')
  const installer = new AcpInstallations(db, temp, {
    platform: 'linux',
    arch: 'x64',
    fetch: async (input) =>
      inputUrl(input).endsWith('/registry.json')
        ? Response.json({ version: '1.0.0', agents: [entry] })
        : new Response(bytes),
  })
  try {
    await installer.install(entry.id)
    const { command } = installer.launch(entry.id)
    expect((await execFileAsync(command)).stdout).toContain('helper-ready')
    expect((await stat(join(dirname(command), 'helper'))).mode & 0o7777).toBe(0o700)
    expect((await stat(join(dirname(command), 'config'))).mode & 0o7777).toBe(0o600)
  } finally {
    await installer.dispose()
    db.close()
    await rm(temp, { recursive: true, force: true })
  }
})
