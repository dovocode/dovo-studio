import { expect, it, vi } from 'vite-plus/test'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { createServer as httpServer } from 'node:http'
import { createServer, connect } from 'node:net'
import {
  testSsh,
  openTunnel,
  startSsh,
  readyReverseForward,
  copyArtifact,
  stopSsh,
} from './device-host-ssh'
const exec = promisify(execFile)
async function port() {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test port')
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  return address.port
}
// Opt-in: uses an isolated, unprivileged loopback sshd; never changes the user's keys or known_hosts.
it.skipIf(process.env.DOVO_TEST_REAL_SSH !== '1')(
  'uses real key-auth SSH/SFTP and forwards an IPv6-only development server',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'dovo-ssh-integration-'))
    const staging = await mkdtemp(join(tmpdir(), 'dovo-device-host-'))
    const children: ChildProcess[] = []
    const api = httpServer((_request, response) => response.end('paired API'))
    const dev = httpServer((_request, response) => response.end('IPv6 dev server'))
    try {
      const key = join(root, 'identity'),
        hostKey = join(root, 'host-key'),
        config = join(root, 'sshd_config')
      await exec('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key])
      await exec('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', hostKey])
      const sshPort = await port(),
        remotePort = await port()
      await writeFile(join(root, 'authorized_keys'), await readFile(`${key}.pub`), { mode: 0o600 })
      await writeFile(
        config,
        [
          `Port ${sshPort}`,
          'ListenAddress 127.0.0.1',
          `HostKey ${hostKey}`,
          `PidFile ${join(root, 'sshd.pid')}`,
          `AuthorizedKeysFile ${join(root, 'authorized_keys')}`,
          'StrictModes no',
          'PasswordAuthentication no',
          'KbdInteractiveAuthentication no',
          'UsePAM no',
          'AllowTcpForwarding yes',
          'GatewayPorts clientspecified',
          'Subsystem sftp internal-sftp',
          `AllowUsers ${userInfo().username}`,
        ].join('\n'),
      )
      let diagnostic = ''
      const daemon = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', config], {
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      children.push(daemon)
      daemon.stderr.on('data', (chunk: Buffer) => {
        diagnostic = (diagnostic + chunk.toString()).slice(-8192)
      })
      await vi.waitFor(
        async () => {
          if (daemon.exitCode !== null) throw new Error(`Loopback sshd failed: ${diagnostic}`)
          await new Promise<void>((resolve, reject) => {
            const socket = connect({ host: '127.0.0.1', port: sshPort })
            socket.once('connect', () => {
              socket.destroy()
              resolve()
            })
            socket.once('error', reject)
          })
        },
        { timeout: 4000 },
      )
      const publicKey = (await readFile(`${hostKey}.pub`, 'utf8'))
        .trim()
        .split(' ')
        .slice(0, 2)
        .join(' ')
      const known = join(root, 'known_hosts'),
        clientConfig = join(root, 'ssh_config')
      await writeFile(known, `[127.0.0.1]:${sshPort} ${publicKey}\n`)
      await writeFile(
        clientConfig,
        `Host *\n  UserKnownHostsFile ${known}\n  GlobalKnownHostsFile /dev/null\n`,
      )
      const bin = join(root, 'bin')
      await mkdir(bin)
      for (const name of ['ssh', 'scp'])
        await writeFile(
          join(bin, name),
          `#!/bin/sh\nexec /usr/bin/${name} -F '${clientConfig}' "$@"\n`,
          { mode: 0o700 },
        )
      vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
      await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve))
      await new Promise<void>((resolve) => dev.listen(0, '::1', resolve))
      const apiAddress = api.address(),
        devAddress = dev.address()
      if (
        !apiAddress ||
        typeof apiAddress === 'string' ||
        !devAddress ||
        typeof devAddress === 'string'
      )
        throw new Error('Missing HTTP test port')
      const host = {
        id: 'loopback',
        name: 'Loopback',
        sshHost: '127.0.0.1',
        sshUser: userInfo().username,
        sshPort,
        identityFile: key,
        runtimeAddress: `http://127.0.0.1:${apiAddress.port}`,
        token: 'paired-token',
        agentAccess: false,
      }
      await testSsh(host)
      const tunnel = await openTunnel(host)
      children.push(tunnel.child)
      expect(await (await fetch(tunnel.address)).text()).toBe('paired API')
      const source = join(root, 'source.apk'),
        destination = join(staging, 'artifact.apk')
      await writeFile(source, 'verified APK')
      await copyArtifact(host, source, destination, false)
      expect(await readFile(destination, 'utf8')).toBe('verified APK')
      const app = join(root, 'source.app')
      await mkdir(app)
      await writeFile(join(app, 'Info.plist'), 'test bundle')
      await copyArtifact(host, app, join(staging, 'artifact.app'), true)
      expect(await readFile(join(staging, 'artifact.app', 'Info.plist'), 'utf8')).toBe(
        'test bundle',
      )
      const reverse = startSsh(
        host,
        `127.0.0.1:${remotePort}:localhost:${devAddress.port}`,
        true,
        true,
      )
      children.push(reverse)
      await readyReverseForward(reverse)
      expect(await (await fetch(`http://127.0.0.1:${remotePort}`)).text()).toBe('IPv6 dev server')
    } finally {
      vi.unstubAllEnvs()
      await Promise.allSettled(children.reverse().map(stopSsh))
      await Promise.all(
        [api, dev].map(
          (server) =>
            new Promise<void>((resolve) => {
              server.close(() => resolve())
              server.closeAllConnections()
            }),
        ),
      )
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(staging, { recursive: true, force: true }),
      ])
    }
  },
  30000,
)
