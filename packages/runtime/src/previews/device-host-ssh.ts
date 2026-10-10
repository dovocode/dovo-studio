import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer, connect } from 'node:net'
import { homedir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import type { DeviceHost } from '@dovo/protocol'
import { HttpError } from '../errors.js'
const exec = promisify(execFile)
export function sshArgs(host: DeviceHost) {
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'PreferredAuthentications=publickey',
    '-o',
    'ForwardAgent=no',
    '-o',
    'ControlMaster=no',
    '-o',
    'ControlPath=none',
    '-o',
    'ControlPersist=no',
    '-o',
    'PasswordAuthentication=no',
    '-o',
    'KbdInteractiveAuthentication=no',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'ConnectTimeout=8',
    '-o',
    'ConnectionAttempts=1',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=2',
    '-p',
    String(host.sshPort),
    '-l',
    host.sshUser,
  ]
  if (host.identityFile) {
    const path = host.identityFile.startsWith('~/')
      ? join(homedir(), host.identityFile.slice(2))
      : host.identityFile
    if (!isAbsolute(path))
      throw new HttpError(400, 'SSH identity must be an absolute path on this runtime')
    args.push('-o', 'IdentitiesOnly=yes', '-i', path)
  }
  return args
}
export async function testSsh(host: DeviceHost) {
  try {
    await exec('ssh', [...sshArgs(host), '--', host.sshHost, 'exit'], {
      timeout: 12000,
      maxBuffer: 65536,
      windowsHide: true,
    })
  } catch {
    throw new HttpError(
      502,
      'SSH key authentication failed. Check the host, identity and trusted known_hosts entry on this runtime.',
    )
  }
}
async function freePort() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = address && typeof address !== 'string' ? address.port : 0
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  if (!port) throw new HttpError(502, 'Could not allocate an SSH tunnel port')
  return port
}
export async function stopSsh(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}
export function startSsh(host: DeviceHost, forwarding: string, reverse = false, verbose = false) {
  const child = spawn(
    'ssh',
    [
      ...sshArgs(host),
      ...(verbose ? ['-v'] : []),
      '-N',
      reverse ? '-R' : '-L',
      forwarding,
      '--',
      host.sshHost,
    ],
    { windowsHide: true, stdio: verbose ? ['ignore', 'ignore', 'pipe'] : 'ignore' },
  )
  // Always consume spawn errors; startup/readiness reports a bounded, credential-free failure.
  child.on('error', () => {})
  return child
}
export async function openTunnel(host: DeviceHost) {
  const remote = new URL(host.runtimeAddress)
  const port = await freePort()
  const destination = remote.hostname.replace(/^\[|\]$/g, '')
  const child = startSsh(
    host,
    `127.0.0.1:${port}:[${destination}]:${remote.port || (remote.protocol === 'https:' ? '443' : '80')}`,
  )
  try {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) break
      const ready = await new Promise<boolean>((resolve) => {
        const socket = connect({ host: '127.0.0.1', port })
        socket.setTimeout(300)
        const finish = (result: boolean) => {
          socket.destroy()
          resolve(result)
        }
        socket.once('connect', () => finish(true))
        socket.once('error', () => finish(false))
        socket.once('timeout', () => finish(false))
      })
      if (ready) return { child, port, address: `${remote.protocol}//127.0.0.1:${port}` }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new HttpError(
      502,
      'SSH tunnel did not become ready. Verify key authentication and forwarding permissions.',
    )
  } catch (error) {
    await stopSsh(child)
    throw error
  }
}
export function deviceArtifactDestination(value: string) {
  const path = value.replaceAll('\\', '/')
  if (
    !/^(?:\/|[a-zA-Z]:\/)/.test(path) ||
    Array.from(path).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    !/\/dovo-device-host-[a-zA-Z0-9_-]+\/artifact\.(?:app|apk)$/.test(path) ||
    path.split('/').some((part) => part === '.' || part === '..')
  )
    throw new HttpError(502, 'Target runtime returned an unsafe artifact staging path')
  return path
}
export async function copyArtifact(
  host: DeviceHost,
  source: string,
  destination: string,
  directory: boolean,
  signal?: AbortSignal,
) {
  destination = deviceArtifactDestination(destination)
  const args = sshArgs(host)
  const portIndex = args.indexOf('-p')
  args[portIndex] = '-P'
  const userIndex = args.indexOf('-l')
  args.splice(userIndex, 2)
  try {
    await exec(
      'scp',
      [
        '-s',
        ...args,
        ...(directory ? ['-r'] : []),
        '--',
        source,
        `${host.sshUser}@${host.sshHost.includes(':') ? `[${host.sshHost}]` : host.sshHost}:${destination}`,
      ],
      { timeout: 120000, maxBuffer: 65536, windowsHide: true, signal },
    )
  } catch (error) {
    if (error && typeof error === 'object') {
      if ('killed' in error && error.killed === true && !signal?.aborted)
        throw new HttpError(504, 'Artifact transfer over SSH timed out after 120 seconds')
      if (
        'stderr' in error &&
        typeof error.stderr === 'string' &&
        /(?:unknown|illegal|invalid) option[^\n]*[—–-]?s\b/i.test(error.stderr)
      )
        throw new HttpError(
          502,
          'Artifact transfer requires OpenSSH 8.7 or newer with scp -s (SFTP) support on this runtime.',
        )
    }
    throw new HttpError(
      502,
      'Artifact transfer over SSH failed. Check SFTP availability and target disk space.',
    )
  }
}

/** OpenSSH confirms the remote bind asynchronously after authentication. */
export async function readyReverseForward(child: ChildProcess) {
  await new Promise<void>((resolve, reject) => {
    let diagnostic = ''
    const done = (error?: HttpError) => {
      clearTimeout(timer)
      child.off('error', failed)
      child.off('exit', failed)
      child.stderr?.off('data', data)
      // Drain subsequent diagnostics without recording credentials or unbounded output.
      child.stderr?.resume()
      if (error) reject(error)
      else resolve()
    }
    const failed = () =>
      done(
        new HttpError(
          502,
          'SSH reverse forwarding failed. Check key authentication, port availability and forwarding permissions.',
        ),
      )
    const data = (chunk: Buffer) => {
      diagnostic = (diagnostic + chunk.toString()).slice(-65536)
      if (/overridden by server GatewayPorts/i.test(diagnostic))
        done(
          new HttpError(
            409,
            'Configure GatewayPorts clientspecified on the destination SSH server to allow physical phones to reach the forwarded port.',
          ),
        )
      else if (/remote forward success for:/.test(diagnostic)) done()
    }
    const timer = setTimeout(
      () => done(new HttpError(504, 'SSH reverse forwarding did not become ready')),
      12000,
    )
    child.once('error', failed)
    child.once('exit', failed)
    child.stderr?.on('data', data)
  })
}
