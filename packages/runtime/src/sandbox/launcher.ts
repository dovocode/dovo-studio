import {
  spawn,
  type ChildProcess,
  type ChildProcessByStdio,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
  type SpawnOptionsWithStdioTuple,
  type StdioNull,
  type StdioPipe,
} from 'node:child_process'
import type { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { createServer, type Socket } from 'node:net'
import { basename, isAbsolute } from 'node:path'
import { registerOwnedChildCleanup, stopOwnedChild } from '../agents/execution/stop-owned-child.js'

/** A ready container for one thread. Every harness process and thread terminal for a sandboxed
 * thread starts through `wrapLaunch`, which turns a host launch into `<cli> exec`. */
export interface SandboxSession {
  readonly taskId: string
  /** `docker` or `podman`, or an absolute path to one. */
  readonly cli: string
  readonly container: string
  /** `uid:gid` used for every launch. */
  readonly user: string
  /** Host directory mounted at the same path. Harness temp files that must be visible
   * inside the container (MCP configuration, attachments) go here. */
  readonly stateDirectory: string
  /** Host commands replaced by their in-container equivalent, matched by exact path first,
   * then by executable name. */
  readonly commands: ReadonlyMap<string, readonly string[]>
  /** Names the user or Dovo set for this harness (agent environment and run additions). */
  readonly explicitEnv: ReadonlySet<string>
  /** Runtime host variables this harness may receive, such as its own API key. */
  readonly hostEnv: ReadonlySet<string>
  /** Fixed values for this container, such as a harness configuration directory. */
  readonly env: Readonly<Record<string, string>>
  /** Host paths visible in the container at the same path. */
  readonly mounts: readonly string[]
  /** The project's mise tools failed to install; the agent sees this in its instructions. */
  readonly warning?: string
  /** Hold the container while a launch runs; idle stop waits for every lease. */
  lease(): () => void
  /** Stop every process of one launch inside the container. */
  stopExec(id: string): Promise<void>
}

export type HarnessLaunch = {
  command: string
  args: readonly string[]
  env: NodeJS.ProcessEnv
  cwd?: string
}
export type WrappedLaunch = {
  command: string
  args: string[]
  /** Environment for the container CLI itself. Forwarded names appear as `-e NAME` only, so
   * values never appear in the host process list. */
  env: NodeJS.ProcessEnv
  execId: string
  /** Stop the in-container processes and release the container lease. Safe to call twice. */
  release: () => Promise<void>
}

/** Values that describe the runtime host, its sessions or Dovo's own credentials. They never
 * cross into a sandbox, even when a harness SDK copies them into its launch environment. */
const deniedEnv = new Set([
  'PATH',
  'HOME',
  'PWD',
  'OLDPWD',
  'SHLVL',
  'SHELL',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'HOSTNAME',
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'GPG_AGENT_INFO',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XAUTHORITY',
  'XDG_RUNTIME_DIR',
  'XDG_SESSION_ID',
  'DBUS_SESSION_BUS_ADDRESS',
  'DOVO_OWNER_TOKEN',
  'DOVO_DEVICE_TOKEN',
  'ELECTRON_RUN_AS_NODE',
  'NODE_OPTIONS',
  'DOVO_EXEC_ID',
])
const deniedPrefixes = [
  'DOCKER_',
  'CONTAINER_',
  'PODMAN_',
  'npm_',
  'MISE_',
  'LD_',
  'DYLD_',
  '__CF',
  'SUDO_',
]
/** GitHub credentials cross only when the user put them in this harness's agent settings. */
const githubTokens = new Set([
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
])
/** Harmless terminal and locale settings forwarded from the host. */
const sharedEnv = new Set(['TERM', 'COLORTERM', 'TZ', 'NO_COLOR', 'FORCE_COLOR', 'CI'])

function deniedName(name: string) {
  return deniedEnv.has(name) || deniedPrefixes.some((prefix) => name.startsWith(prefix))
}

/** The variables a sandboxed launch receives. A name crosses only when the agent settings or
 * Dovo set it for this launch, when its value differs from the runtime's inherited value (a
 * harness SDK addition), or when it is on the harness's own allowlist. */
export function sandboxEnvironment(
  env: NodeJS.ProcessEnv,
  session: Pick<SandboxSession, 'explicitEnv' | 'hostEnv' | 'env'>,
  host: NodeJS.ProcessEnv = process.env,
) {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || deniedName(name)) continue
    if (githubTokens.has(name) && !session.explicitEnv.has(name)) continue
    const inherited = host[name] === value
    if (
      session.explicitEnv.has(name) ||
      sharedEnv.has(name) ||
      name.startsWith('LC_') ||
      name === 'LANG' ||
      (inherited ? session.hostEnv.has(name) : true)
    )
      result[name] = value
  }
  for (const name of session.hostEnv) {
    const value = host[name]
    if (value !== undefined && !(name in result) && !deniedName(name) && !githubTokens.has(name))
      result[name] = value
  }
  return { ...result, ...session.env }
}

/** System folders exist in the image too, for example /bin/sh in an ACP terminal request. */
const systemPrefixes = [
  '/bin/',
  '/sbin/',
  '/usr/bin/',
  '/usr/sbin/',
  '/usr/local/bin/',
  '/opt/dovo/',
]

/** The in-container command for a host command. Unknown absolute paths must be mounted. */
export function sandboxCommand(
  session: Pick<SandboxSession, 'commands' | 'mounts'>,
  command: string,
): readonly string[] {
  const exact = session.commands.get(command)
  if (exact) return exact
  const named = session.commands.get(basename(command))
  if (named && (isAbsolute(command) || !command.includes('/'))) return named
  if (
    isAbsolute(command) &&
    !systemPrefixes.some((prefix) => command.startsWith(prefix)) &&
    !session.mounts.some((root) => command === root || command.startsWith(`${root}/`))
  )
    throw new Error(
      `${command} is outside the sandbox. Use a command that is installed in the sandbox, for example through the project's mise.toml.`,
    )
  return [command]
}

/** Build `<cli> exec` arguments. Environment values travel through the CLI's own environment. */
export function wrapLaunch(
  session: SandboxSession,
  launch: HarnessLaunch,
  options: { tty?: boolean } = {},
): Omit<WrappedLaunch, 'release'> {
  const execId = randomUUID()
  const forwarded = { ...sandboxEnvironment(launch.env, session), DOVO_EXEC_ID: execId }
  const names = Object.keys(forwarded).sort()
  const args = [
    'exec',
    '-i',
    ...(options.tty ? ['-t'] : []),
    '--user',
    session.user,
    ...(launch.cwd ? ['--workdir', launch.cwd] : []),
    ...names.flatMap((name) => ['--env', name]),
    session.container,
    ...sandboxCommand(session, launch.command),
    ...launch.args,
  ]
  // The CLI keeps its own host environment (PATH, DOCKER_HOST, XDG_RUNTIME_DIR for Podman) and
  // reads each `--env NAME` value from it. Only the listed names reach the container.
  return { command: session.cli, args, env: { ...process.env, ...forwarded }, execId }
}

/** Wrap a launch and hold the container until `release` runs. */
export function sandboxLaunch(
  session: SandboxSession,
  launch: HarnessLaunch,
  options: { tty?: boolean } = {},
): WrappedLaunch {
  const wrapped = wrapLaunch(session, launch, options)
  const unlease = session.lease()
  let released: Promise<void> | undefined
  return {
    ...wrapped,
    release: () =>
      (released ??= session.stopExec(wrapped.execId).finally(() => {
        unlease()
      })),
  }
}

/** The one spawn path for harness processes. Without a session it is `child_process.spawn`. */
export function spawnHarness(
  session: SandboxSession | undefined,
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioPipe>,
): ChildProcessWithoutNullStreams
export function spawnHarness(
  session: SandboxSession | undefined,
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithStdioTuple<StdioNull, StdioPipe, StdioPipe>,
): ChildProcessByStdio<null, Readable, Readable>
export function spawnHarness(
  session: SandboxSession | undefined,
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess
export function spawnHarness(
  session: SandboxSession | undefined,
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess {
  if (!session) return spawn(command, [...args], options)
  const launch = sandboxLaunch(session, {
    command,
    args,
    env: options.env ?? process.env,
    cwd: typeof options.cwd === 'string' ? options.cwd : options.cwd?.pathname,
  })
  let child: ChildProcess
  try {
    child = spawn(launch.command, launch.args, { ...options, cwd: undefined, env: launch.env })
  } catch (error) {
    void launch.release()
    throw error
  }
  registerOwnedChildCleanup(child, launch.release)
  child.once('close', () => {
    void launch
      .release()
      .catch((error: unknown) => console.error('Could not stop sandboxed process:', error))
  })
  child.once('error', () => {
    void launch.release().catch(() => {})
  })
  return child
}

/** Reach a TCP port inside the container from the host loopback. Each connection runs `socat`
 * through `<cli> exec`, so no port is published and it works without container networking. */
export async function sandboxPortForward(session: SandboxSession, port: number) {
  const connections = new Set<Socket>()
  const server = createServer((socket) => {
    connections.add(socket)
    const child = spawnHarness(session, 'socat', ['STDIO', `TCP:127.0.0.1:${port}`], {
      stdio: ['pipe', 'pipe', 'ignore'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    const close = () => {
      connections.delete(socket)
      socket.destroy()
      void stopOwnedChild(child).catch(() => undefined)
    }
    if (child.stdin && child.stdout) {
      socket.pipe(child.stdin)
      child.stdout.pipe(socket)
    }
    socket.once('close', close)
    socket.on('error', close)
    child.once('close', close)
    child.stdin?.on('error', close)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Sandbox port forward has no port')
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => {
      server.close()
      for (const socket of connections) socket.destroy()
    },
  }
}
