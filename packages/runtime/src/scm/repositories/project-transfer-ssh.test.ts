import { expect, it, vi } from 'vite-plus/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir, userInfo } from 'node:os'
import { createServer, connect } from 'node:net'
import { randomUUID } from 'node:crypto'
import { startRuntime } from '../../index.js'
import { exec } from '../../process.js'
import { addRepository } from './repositories.js'
import { stopSsh } from '../../previews/device-host-ssh.js'

// A real, isolated SSH server. Opt-in because desktop/CI hosts need not ship sshd.
it.skipIf(process.env.DOVO_TEST_REAL_SSH !== '1')(
  'copies a workspace over key-authenticated SSH without sending transfer data to the direct address',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'dovo-copy-ssh-'))
    const children: ChildProcess[] = []
    const runtimes: Awaited<ReturnType<typeof startRuntime>>[] = []
    const owner = 'project-ssh-copy-owner-token-at-least-32-characters'
    try {
      vi.stubEnv('DOVO_DATA_ROOT', join(root, 'dovo'))
      const target = await startRuntime({ databasePath: ':memory:', port: 0, ownerToken: owner })
      const source = await startRuntime({ databasePath: ':memory:', port: 0, ownerToken: owner })
      runtimes.push(target, source)
      const key = join(root, 'identity'),
        hostKey = join(root, 'host-key')
      await exec('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key])
      await exec('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', hostKey])
      const probe = createServer()
      await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
      const address = probe.address()
      if (!address || typeof address === 'string') throw new Error('Missing SSH port')
      const port = address.port
      await new Promise<void>((resolve) => probe.close(() => resolve()))
      await writeFile(join(root, 'authorized_keys'), await readFile(`${key}.pub`), { mode: 0o600 })
      const config = join(root, 'sshd_config')
      await writeFile(
        config,
        [
          `Port ${port}`,
          'ListenAddress 127.0.0.1',
          `HostKey ${hostKey}`,
          `PidFile ${join(root, 'sshd.pid')}`,
          `AuthorizedKeysFile ${join(root, 'authorized_keys')}`,
          'StrictModes no',
          'PasswordAuthentication no',
          'KbdInteractiveAuthentication no',
          'UsePAM no',
          'AllowTcpForwarding yes',
          `AllowUsers ${userInfo().username}`,
        ].join('\n'),
      )
      let diagnostics = ''
      const daemon = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', config], {
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      children.push(daemon)
      daemon.stderr.on('data', (chunk: Buffer) => {
        diagnostics = (diagnostics + chunk.toString()).slice(-8192)
      })
      await vi.waitFor(
        async () => {
          if (daemon.exitCode !== null) throw new Error(`SSH daemon failed: ${diagnostics}`)
          await new Promise<void>((resolve, reject) => {
            const socket = connect({ host: '127.0.0.1', port })
            socket.once('connect', () => {
              socket.destroy()
              resolve()
            })
            socket.once('error', reject)
          })
        },
        { timeout: 4000 },
      )
      const hostPublic = (await readFile(`${hostKey}.pub`, 'utf8'))
        .trim()
        .split(' ')
        .slice(0, 2)
        .join(' ')
      await writeFile(join(root, 'known_hosts'), `[127.0.0.1]:${port} ${hostPublic}\n`)
      await writeFile(
        join(root, 'ssh_config'),
        `Host *\n  UserKnownHostsFile ${join(root, 'known_hosts')}\n  GlobalKnownHostsFile /dev/null\n`,
      )
      await mkdir(join(root, 'bin'))
      await writeFile(
        join(root, 'bin', 'ssh'),
        `#!/bin/sh\nexec /usr/bin/ssh -F '${join(root, 'ssh_config')}' "$@"\n`,
        { mode: 0o700 },
      )
      vi.stubEnv('PATH', `${join(root, 'bin')}:${process.env.PATH}`)
      const path = join(root, 'project')
      await mkdir(path)
      const binary = Buffer.alloc(800000, 241)
      await writeFile(join(path, 'source.bin'), binary)
      const repo = await addRepository(source.services, { source: 'local', name: 'SSH copy', path })
      const targetAddress = 'https://unreachable.example.invalid'
      source.services.retrievalPeers.register('owner', {
        sessionId: 'ssh-copy',
        peers: [
          {
            id: 'target',
            name: 'SSH destination',
            connection: {
              address: targetAddress,
              runtimeId: target.services.runtimeId,
              token: owner,
            },
          },
        ],
      })
      const fetch = globalThis.fetch,
        origins: string[] = []
      vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
        if (
          (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).includes(
            '/api/scm/project-transfer/',
          )
        )
          origins.push(
            new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).origin,
          )
        return fetch(url, init)
      })
      const id = randomUUID()
      source.services.projectTransfers.start(
        {
          id,
          repositoryId: repo.id,
          targetId: target.services.runtimeId,
          ignoredFiles: [],
          ssh: {
            sshHost: '127.0.0.1',
            sshUser: userInfo().username,
            sshPort: port,
            identityFile: key,
            runtimePort: target.port,
          },
        },
        'owner',
        () => source.services.devices.authenticate(owner),
      )
      await vi.waitFor(
        () => expect(source.services.projectTransfers.list()[0]?.state).toMatch(/completed|failed/),
        { timeout: 15000 },
      )
      const job = source.services.projectTransfers.list()[0]
      expect(job?.error).toBeUndefined()
      expect(job?.state).toBe('completed')
      expect(origins.length).toBeGreaterThan(4)
      expect(origins).not.toContain(targetAddress)
      expect(await readFile(join(job!.path!, 'source.bin'))).toEqual(binary)
      expect(target.services.store.get().repositories).toHaveLength(1)
      await source.services.projectTransfers.cancel(id)
      const gitPath = join(root, 'git-project')
      await exec('git', ['init', '-b', 'main', gitPath])
      await exec('git', ['config', 'user.name', 'SSH test'], { cwd: gitPath })
      await exec('git', ['config', 'user.email', 'ssh@example.test'], { cwd: gitPath })
      await writeFile(join(gitPath, 'tracked'), 'Committed')
      await exec('git', ['add', '.'], { cwd: gitPath })
      await exec('git', ['commit', '-qm', 'Initial'], { cwd: gitPath })
      const gitRepo = await addRepository(source.services, {
        source: 'local',
        name: 'Git project',
        path: gitPath,
      })
      const worktreePath = join(root, 'feature')
      await exec('git', ['worktree', 'add', '-b', 'feature', worktreePath], { cwd: gitPath })
      await writeFile(join(worktreePath, 'tracked'), 'Feature local edit')
      const ssh = {
        sshHost: '127.0.0.1',
        sshUser: userInfo().username,
        sshPort: port,
        identityFile: key,
        runtimePort: target.port,
      }
      const plan = await source.services.projectTransfers.plan(
        { repositoryId: gitRepo.id, worktreePath, targetId: target.services.runtimeId, ssh },
        () => source.services.devices.authenticate(owner),
      )
      expect(plan.repositories).toEqual([])
      const worktreeId = randomUUID()
      source.services.projectTransfers.start(
        {
          id: worktreeId,
          repositoryId: gitRepo.id,
          worktreePath,
          targetId: target.services.runtimeId,
          ignoredFiles: [],
          destination: { parentDirectory: root },
          ssh,
        },
        'owner',
        () => source.services.devices.authenticate(owner),
      )
      await vi.waitFor(
        () =>
          expect(
            source.services.projectTransfers.list().find((job) => job.id === worktreeId)?.state,
          ).toMatch(/completed|failed/),
        { timeout: 15000 },
      )
      const worktreeJob = source.services.projectTransfers
        .list()
        .find((job) => job.id === worktreeId)!
      expect(worktreeJob.error).toBeUndefined()
      expect(worktreeJob.state).toBe('completed')
      expect(worktreeJob.path!.startsWith(plan.worktreesRoot)).toBe(true)
      expect(await readFile(join(worktreeJob.path!, 'tracked'), 'utf8')).toBe('Feature local edit')
      expect(origins).not.toContain(targetAddress)
      expect(target.services.store.get().repositories).toHaveLength(2)
      await stopSsh(daemon)
      origins.length = 0
      const failedId = randomUUID()
      source.services.projectTransfers.start(
        {
          id: failedId,
          repositoryId: repo.id,
          targetId: target.services.runtimeId,
          ignoredFiles: [],
          ssh: {
            sshHost: '127.0.0.1',
            sshUser: userInfo().username,
            sshPort: port,
            identityFile: key,
            runtimePort: target.port,
          },
        },
        'owner',
        () => source.services.devices.authenticate(owner),
      )
      await vi.waitFor(
        () =>
          expect(
            source.services.projectTransfers.list().find((job) => job.id === failedId)?.state,
          ).toBe('failed'),
        { timeout: 15000 },
      )
      expect(origins).toEqual([])
      expect(target.services.store.get().repositories).toHaveLength(2)
    } finally {
      vi.restoreAllMocks()
      await Promise.allSettled(runtimes.map((runtime) => runtime.close()))
      await Promise.allSettled(children.map(stopSsh))
      vi.unstubAllEnvs()
      await rm(root, { recursive: true, force: true })
    }
  },
  30000,
)
