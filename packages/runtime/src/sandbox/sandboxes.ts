import { createHash } from 'node:crypto'
import {
  constants,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  type WriteStream,
} from 'node:fs'
import { copyFile, lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { connect, createServer, type Server } from 'node:net'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import {
  defaultContainerSandboxMemoryMb,
  type AgentDiscovery,
  type ContainerSandbox,
  type ContainerSandboxStatus,
  type ContainerSandboxThreadStatus,
  type McpServer,
} from '@dovo/protocol'
import { exec, processEnvironment } from '../process.js'
import type { AcpLaunch } from '../agents/execution/types.js'
import {
  detectContainerCli,
  runChecked,
  runCli,
  sandboxSetupMessage,
  type CliRunner,
  type ContainerCli,
} from './container-cli.js'
import {
  harnessProfiles,
  harnessSandboxSupport,
  reportedHarnessVersion,
  type HarnessHome,
} from './harnesses.js'
import {
  imageTag,
  loadImageSource,
  readAgentToolsBundle,
  writeBuildContext,
  type ImageSource,
} from './image.js'
import type { SandboxSession } from './launcher.js'
import { gitMounts, resolveGitLayout, verifyGitLayout } from './git-mounts.js'
import { hostCommandWritable } from './host-commands.js'
import { SandboxRecords, type RecordedCheckout } from './sandbox-records.js'
import type { PinnedGitLayout } from '../scm/git/hardened-git.js'

const MISE_VOLUME = 'dovo-sandbox-mise'
const LABEL = 'dev.dovo.sandbox'
/** Provider processes release after two idle minutes (warm-processes.ts). A container waits
 * longer, so a quick follow-up turn, terminal or warm release does not pay a restart. */
const SANDBOX_IDLE_STOP_MS = 10 * 60_000
const TOOLS_PATH = '/opt/dovo/lib/agent-tools.mjs'
const TOOLS_COMMAND = '/opt/dovo/lib/dovo-task-tools'

export type AcpSandboxDistribution = {
  hostCommand: string
  registryId: string
  version: string
  distribution:
    | { kind: 'binary'; value: { archive: string; sha256?: string; cmd: string } }
    | { kind: 'npx' | 'uvx'; value: { package: string } }
  package?: { name: string; spec: string }
}
export type SandboxRequest = {
  taskId: string
  sandbox: ContainerSandbox
  cwd: string
  linked?: ReadonlyArray<{ path: string; access: 'read-only' | 'edit' }>
  /** The resolved harness. Terminals before the first turn pass the thread's configured one. */
  agent?: AgentDiscovery
  acpLaunch?: AcpLaunch
  progress?: (text: string) => void
  signal?: AbortSignal
}
export type SandboxesOptions = {
  runtimeId: string
  /** `<runtime data>/sandboxes`: per-thread state directories and build logs. */
  root: string
  taskTools: () => { host: string; port: number } | undefined
  /** Thread exists and is not archived. Others lose their container on reconcile. */
  keepThread: (taskId: string) => boolean
  /** Thread exists, also when archived. Others lose their recorded Git layout on reconcile. */
  threadExists?: (taskId: string) => boolean
  acpDistribution?: (installationId: string) => Promise<AcpSandboxDistribution>
  runner?: CliRunner
  detect?: () => Promise<{ cli?: ContainerCli; message?: string }>
  loadImage?: (buildArgs: Record<string, string>) => Promise<ImageSource>
  agentToolsBundle?: () => Promise<Buffer>
  hostVersion?: (command: string, env: Record<string, string>) => Promise<string | undefined>
  /** Records a checkout's Git layout the first time a sandbox mounts it. */
  resolveGitLayout?: (directory: string) => Promise<PinnedGitLayout | undefined>
  platform?: NodeJS.Platform
  arch?: string
  home?: string
  ids?: { uid: number; gid: number }
  idleStopMs?: number
}

/** A bind mount at `path` in the container. `source` is the host path when it differs. */
type Mount = { path: string; readOnly: boolean; source?: string }
type Container = {
  name: string
  spec: string
  mounts: Mount[]
  /** Setup done since the last start: home directory, tools bundle, project tools. */
  prepared: boolean
  harnesses: Set<string>
  projectWarning?: string
}

function parseMounts(label: string | undefined): Mount[] {
  if (!label) return []
  try {
    const value: unknown = JSON.parse(label)
    return Array.isArray(value)
      ? value.flatMap((item: unknown) =>
          item && typeof item === 'object' && 'path' in item && typeof item.path === 'string'
            ? [
                {
                  path: item.path,
                  readOnly: 'readOnly' in item && item.readOnly === true,
                  ...('source' in item && typeof item.source === 'string'
                    ? { source: item.source }
                    : {}),
                },
              ]
            : [],
        )
      : []
  } catch {
    return []
  }
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const tail = (text: string, lines = 30) => text.trim().split('\n').slice(-lines).join('\n')

async function defaultHostVersion(command: string, env: Record<string, string>) {
  try {
    const { stdout } = await exec(command, ['--version'], {
      timeout: 5000,
      maxBuffer: 64 * 1024,
      env: processEnvironment(env),
    })
    return reportedHarnessVersion(stdout)
  } catch {
    return undefined
  }
}
/** One container per sandboxed thread: created lazily, reused across turns and runtime
 * restarts, stopped when idle and removed with its thread. */
export class Sandboxes {
  revision = 0
  private cli?: ContainerCli
  private unavailable?: string
  private detecting?: Promise<void>
  private threads = new Map<string, ContainerSandboxThreadStatus>()
  private containers = new Map<string, Container>()
  private pending = new Map<string, Promise<SandboxSession>>()
  private builds = new Map<string, Promise<string>>()
  private installs = new Map<string, Promise<string>>()
  private versions = new Map<string, { value?: string; expires: number }>()
  private leases = new Map<string, number>()
  private idle = new Map<string, ReturnType<typeof setTimeout>>()
  private sockets = new Map<string, Server>()
  private sessions = new Map<string, SandboxSession>()
  private readonly runner: CliRunner
  private readonly platform: NodeJS.Platform
  private readonly home: string
  private readonly ids: { uid: number; gid: number }
  private readonly records: SandboxRecords

  constructor(private options: SandboxesOptions) {
    this.runner = options.runner ?? runCli
    this.platform = options.platform ?? process.platform
    this.home = options.home ?? homedir()
    this.ids = options.ids ?? { uid: process.getuid?.() ?? 1000, gid: process.getgid?.() ?? 1000 }
    this.records = new SandboxRecords(join(options.root, 'records'))
  }

  /** The Git layout for Dovo's own Git calls in a real path whose Git folders a sandbox can
   * write. Undefined for checkouts that share nothing with a sandbox. */
  async gitLayout(realPath: string) {
    return this.records.gitLayout(realPath) ?? (await this.sharedGitLayout(realPath))
  }

  /**
   * A checkout that shares its common Git folder with a recorded checkout: the main checkout of a
   * sandboxed linked worktree, or another worktree of the same repository. The sandbox can write
   * that common folder (submodule config under `modules/`, a `commondir` file), so Dovo's Git
   * calls there use the same protections. The sandbox cannot write the checkout's own files,
   * hooks or config, so hooks still run.
   */
  private async sharedGitLayout(real: string): Promise<PinnedGitLayout | undefined> {
    const commons = this.records.commonDirs()
    if (!commons.size) return undefined
    for (let folder = real; ; folder = dirname(folder)) {
      const dotGit = join(folder, '.git')
      const info = await lstat(dotGit).catch(() => undefined)
      if (info) {
        let gitDir: string | undefined
        if (info.isDirectory()) gitDir = dotGit
        else if (info.isFile()) {
          const text = (await readFile(dotGit, 'utf8')).replace(/\r?\n$/, '')
          if (text.startsWith('gitdir: '))
            gitDir = await realpath(resolve(folder, text.slice('gitdir: '.length))).catch(
              () => undefined,
            )
        }
        if (!gitDir) return undefined
        const commonDir =
          gitDir === dotGit
            ? dotGit
            : basename(dirname(gitDir)) === 'worktrees'
              ? dirname(dirname(gitDir))
              : gitDir
        return commons.has(commonDir)
          ? { worktree: folder, gitDir, commonDir, keepHooks: true }
          : undefined
      }
      if (folder === dirname(folder)) return undefined
    }
  }

  /** Whether running this command on the host could start a file that a sandbox can change.
   * Dovo does not probe or version-check such commands. */
  hostCommandWritable(command: string, env: Readonly<Record<string, string | undefined>> = {}) {
    return hostCommandWritable(command, env.PATH ?? process.env.PATH, (path) =>
      this.records.writable(path),
    )
  }

  status(): ContainerSandboxStatus {
    return {
      available: !!this.cli,
      ...(this.cli ? { cli: this.cli.kind } : {}),
      ...(this.unavailable && !this.cli ? { message: this.unavailable } : {}),
      threads: [...this.threads.values()],
    }
  }

  /** Detect the container CLI. A failed detection runs again on the next request. */
  detect(force = false) {
    if (this.cli && !force) return Promise.resolve()
    this.detecting ??= (this.options.detect ?? (() => detectContainerCli()))()
      .then((result) => {
        this.cli = result.cli
        this.unavailable = result.cli ? undefined : (result.message ?? sandboxSetupMessage)
        this.changed()
      })
      .finally(() => {
        this.detecting = undefined
      })
    return this.detecting
  }

  private changed() {
    this.revision++
  }
  private setThread(
    taskId: string,
    state: ContainerSandboxThreadStatus['state'],
    detail?: string,
    logPath?: string,
  ) {
    this.threads.set(taskId, {
      taskId,
      state,
      ...(detail ? { detail: detail.slice(-4000) } : {}),
      ...(logPath ? { logPath } : {}),
    })
    this.changed()
  }

  containerName(taskId: string) {
    return `dovo-sandbox-${hash([this.options.runtimeId, taskId]).slice(0, 20)}`
  }
  stateDirectory(taskId: string) {
    return join(this.options.root, 'threads', hash(taskId).slice(0, 16))
  }
  /** Private harness folders for one thread. Outside the state folder, so no container sees
   * the parent path and an agent cannot replace it with a link. */
  private homesDirectory(taskId: string) {
    return join(this.options.root, 'homes', hash(taskId).slice(0, 16))
  }
  private get user() {
    return this.cli?.rootless ? '0:0' : `${this.ids.uid}:${this.ids.gid}`
  }
  /** Unix sockets in bind mounts work on Linux, also without container networking. Docker
   * Desktop reaches the host loopback through host.docker.internal instead. */
  private get socketTransport() {
    return this.platform === 'linux'
  }

  /** The Dovo task-tools MCP server as the sandboxed harness starts it. */
  toolServer(taskId: string, server: McpServer): McpServer {
    if (server.transport !== 'stdio') return server
    const values = { ...server.envValues }
    delete values.ELECTRON_RUN_AS_NODE
    const tools = this.options.taskTools()
    if (this.socketTransport)
      values.DOVO_TASK_SOCKET = join(this.stateDirectory(taskId), 'dovo.sock')
    else if (tools) values.DOVO_TASK_URL = `http://host.docker.internal:${tools.port}`
    return { ...server, command: TOOLS_COMMAND, args: [], envValues: values }
  }

  /** Whether this harness can run in a sandbox, and why not. */
  support(agent: AgentDiscovery, acpLaunch?: AcpLaunch, cwd?: string) {
    return harnessSandboxSupport(agent, {
      acpLaunch,
      platform: this.platform,
      home: this.home,
      mounted: (path) => !!cwd && (path === cwd || path.startsWith(`${cwd}/`)),
    })
  }

  /**
   * The Git layout of each checkout, recorded the first time this thread's sandbox mounts it,
   * before any agent code runs there. A checkout that another sandbox already recorded keeps
   * that record, because the other agent could have changed its files. Every later call checks
   * the files on disk against the record and fails on any change, before anything is mounted.
   */
  private async pinGit(taskId: string, roots: readonly string[]) {
    const record = this.records.get(taskId)
    const checkouts: RecordedCheckout[] = [...(record?.checkouts ?? [])]
    let added = false
    for (const root of roots) {
      if (checkouts.some((item) => item.root === root)) continue
      const real = await realpath(root)
      const known = this.records.checkout(real)
      checkouts.push({
        root,
        real,
        ...(known
          ? known.layout
            ? { layout: known.layout }
            : {}
          : await (this.options.resolveGitLayout ?? resolveGitLayout)(root).then((layout) =>
              layout ? { layout } : {},
            )),
      })
      added = true
    }
    if (added)
      this.records.save({
        taskId,
        created: record?.created ?? new Date().toISOString(),
        checkouts,
        writable: record?.writable ?? [],
      })
    const layouts = new Map<string, PinnedGitLayout | undefined>()
    for (const root of roots) {
      const layout = checkouts.find((item) => item.root === root)?.layout
      if (layout) await verifyGitLayout(root, layout)
      layouts.set(root, layout)
    }
    return layouts
  }

  /** Keep the writable host paths of this thread's container, so that Dovo does not run
   * commands from them on the host. Only grows: a path stays listed after its mount goes. */
  private async recordWritable(taskId: string, mounts: readonly Mount[]) {
    const record = this.records.get(taskId)
    if (!record) return
    const writable = new Set(record.writable)
    for (const mount of mounts)
      if (!mount.readOnly) {
        const source = mount.source ?? mount.path
        writable.add(await realpath(source).catch(() => resolve(source)))
      }
    if (writable.size !== record.writable.length)
      this.records.save({ ...record, writable: [...writable] })
  }

  /**
   * Mounts for one harness folder: the thread's private folder at the host path, the host's
   * configuration read-only, and only login files and transcripts shared writable. Dovo writes
   * into the private folder only with exclusive creation, so it never follows a link that the
   * agent placed there.
   */
  private async homeMounts(taskId: string, home: HarnessHome): Promise<Mount[]> {
    const own = join(this.homesDirectory(taskId), hash(home.directory).slice(0, 16))
    await mkdir(own, { recursive: true, mode: 0o700 })
    const mounts: Mount[] = [{ path: home.directory, source: own, readOnly: false }]
    const present = (path: string) =>
      lstat(path).then(
        () => true,
        () => false,
      )
    for (const name of home.readOnly) {
      const path = join(home.directory, name)
      if (await present(path)) mounts.push({ path, readOnly: true })
    }
    for (const item of home.shared) {
      const path = join(home.directory, item.name)
      if (item.folder) await mkdir(path, { recursive: true, mode: 0o700 })
      if (await present(path)) mounts.push({ path, readOnly: false })
    }
    for (const item of home.seed ?? []) {
      if (!(await present(item.from))) continue
      await copyFile(item.from, join(own, item.name), constants.COPYFILE_EXCL).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error
        },
      )
    }
    return mounts
  }

  ensure(request: SandboxRequest): Promise<SandboxSession> {
    const running = this.pending.get(request.taskId)
    if (running) return running.then(() => this.ensure(request))
    const work = this.prepare(request).finally(() => this.pending.delete(request.taskId))
    this.pending.set(request.taskId, work)
    return work
  }

  private async prepare(request: SandboxRequest): Promise<SandboxSession> {
    const { taskId } = request
    const progress = (text: string) => {
      request.progress?.(text)
      this.setThread(taskId, 'preparing', text)
    }
    try {
      await this.detect()
      const cli = this.cli
      if (!cli) throw new Error(this.unavailable ?? sandboxSetupMessage)
      const agent = request.agent
      if (agent) {
        const support = this.support(agent, request.acpLaunch, request.cwd)
        if (!support.supported)
          throw new Error(support.note ?? `${agent.provider} cannot run in a sandbox`)
      }
      progress('Preparing the sandbox image')
      const image = await this.image(cli, taskId, progress)
      request.signal?.throwIfAborted()
      const commands = new Map<string, string[]>()
      const harness = agent ? harnessProfiles[agent.provider] : undefined
      const env = agent?.env ?? {}
      const installed: Array<{ name: string; tool: string; executable: string }> = []
      // Node LTS runs the Dovo tools server and Node-based harnesses in every sandbox.
      await this.install(cli, image, 'node', 'lts', progress)
      if (agent && harness?.tool) {
        const command = agent.endpoint || harness.executables[0] || agent.provider
        const version = await this.hostVersion(command, env, request)
        const tool = await this.install(cli, image, harness.tool, version, progress)
        for (const name of harness.executables) installed.push({ name, tool, executable: name })
      }
      if (agent?.provider === 'acp' && agent.acpInstallationId && request.acpLaunch) {
        const launch = await this.installAcp(cli, image, agent.acpInstallationId, progress)
        commands.set(request.acpLaunch.command, launch.command)
        installed.push(...launch.links)
      }
      // A host path to the harness becomes its in-container command. Harnesses without a Dovo
      // install (Grok, Muse) resolve through the container PATH, for example from mise.toml.
      for (const name of harness?.executables ?? [])
        commands.set(name, [harness?.tool ? `/opt/dovo/harness/${name}` : name])
      request.signal?.throwIfAborted()
      const editable = (request.linked ?? []).flatMap((item) =>
        item.access === 'edit' ? [item.path] : [],
      )
      // Before anything is mounted: record the Git layout of a new checkout, or check that a
      // recorded one has not changed.
      const layouts = await this.pinGit(taskId, [request.cwd, ...editable])
      const state = this.stateDirectory(taskId)
      await mkdir(state, { recursive: true, mode: 0o700 })
      const homes = agent ? (harness?.homes(env, this.home) ?? []) : []
      const homeMounts: Mount[] = []
      for (const home of homes) homeMounts.push(...(await this.homeMounts(taskId, home)))
      const git = await gitMounts(request.cwd, editable, layouts)
      const mounts: Mount[] = [
        { path: request.cwd, readOnly: false },
        ...(git.common ? [git.common] : []),
        ...(request.linked ?? []).map((item) => ({
          path: item.path,
          readOnly: item.access === 'read-only',
        })),
        ...homeMounts,
        { path: state, readOnly: false },
        // Git folders on themselves and read-only Git files: after the writable checkout.
        ...git.protect,
      ]
      await this.recordWritable(taskId, mounts)
      const container = await this.container(cli, image, request, mounts, progress)
      if (this.socketTransport) await this.socket(taskId, state)
      await this.setup(cli, container, request, installed, progress)
      this.setThread(taskId, 'running', container.projectWarning)
      const session = this.session(cli, container, request, {
        commands,
        mounts: container.mounts.map((mount) => mount.path),
        env: harness?.containerEnv?.(env, this.home) ?? {},
        hostEnv: harness?.hostEnv ?? [],
      })
      this.sessions.set(taskId, session)
      return session
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const current = this.threads.get(taskId)
      this.setThread(taskId, 'failed', message, current?.logPath)
      throw new Error(`The sandbox could not start: ${message}`, { cause: error })
    }
  }

  private session(
    cli: ContainerCli,
    container: Container,
    request: SandboxRequest,
    launch: {
      commands: Map<string, string[]>
      mounts: string[]
      env: Record<string, string>
      hostEnv: readonly string[]
    },
  ): SandboxSession {
    const { taskId } = request
    return {
      taskId,
      cli: cli.command,
      container: container.name,
      user: this.user,
      stateDirectory: this.stateDirectory(taskId),
      commands: launch.commands,
      explicitEnv: new Set(Object.keys(request.agent?.env ?? {})),
      hostEnv: new Set(launch.hostEnv),
      env: launch.env,
      mounts: launch.mounts,
      ...(container.projectWarning ? { warning: container.projectWarning } : {}),
      lease: () => this.lease(taskId),
      stopExec: (id) => this.stopExec(cli, container.name, id),
    }
  }

  /** The ready container for a thread terminal, after `ensure`. */
  current(taskId: string) {
    return this.sessions.get(taskId)
  }

  private lease(taskId: string) {
    clearTimeout(this.idle.get(taskId))
    this.idle.delete(taskId)
    this.leases.set(taskId, (this.leases.get(taskId) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const count = (this.leases.get(taskId) ?? 1) - 1
      if (count > 0) return void this.leases.set(taskId, count)
      this.leases.delete(taskId)
      const timer = setTimeout(() => {
        this.idle.delete(taskId)
        void this.stopIdle(taskId).catch((error: unknown) =>
          console.error('Could not stop idle sandbox', taskId, error),
        )
      }, this.options.idleStopMs ?? SANDBOX_IDLE_STOP_MS)
      timer.unref()
      this.idle.set(taskId, timer)
    }
  }

  private async stopIdle(taskId: string) {
    const container = this.containers.get(taskId)
    if (!container || !this.cli || this.leases.get(taskId) || this.pending.has(taskId)) return
    this.sessions.delete(taskId)
    await runChecked(this.runner, this.cli.command, ['stop', '--time', '5', container.name])
    container.prepared = false
    container.harnesses.clear()
    this.setThread(taskId, 'stopped')
  }

  private async stopExec(cli: ContainerCli, name: string, id: string) {
    const result = await this.runner(
      cli.command,
      // /proc/<pid>/environ uses a ptrace access check. Container root lacks CAP_SYS_PTRACE,
      // so it cannot read a non-root harness's environment. Use the harness's own uid.
      ['exec', '--user', this.user, name, '/opt/dovo/bin/dovo-kill', id],
      {
        timeout: 15000,
      },
    )
    // A stopped or removed container has no processes left to stop.
    if (
      result.code !== 0 &&
      !/is not running|No such container|no container with name/i.test(result.stderr)
    )
      throw new Error(`Could not stop the sandboxed process: ${tail(result.stderr, 3)}`)
  }

  private buildArgs(cli: ContainerCli): Record<string, string> {
    const root = cli.rootless || this.ids.uid === 0
    return { HOST_UID: String(root ? 0 : this.ids.uid), HOST_GID: String(root ? 0 : this.ids.gid) }
  }

  private async image(cli: ContainerCli, taskId: string, progress: (text: string) => void) {
    const args = this.buildArgs(cli)
    const source = await (this.options.loadImage ?? loadImageSource)(args)
    const tag = imageTag(source)
    let build = this.builds.get(tag)
    if (!build) {
      build = this.buildImage(cli, source, tag, args, taskId, progress)
      this.builds.set(tag, build)
      void build.catch(() => this.builds.delete(tag))
    }
    return build
  }

  private async buildImage(
    cli: ContainerCli,
    source: ImageSource,
    tag: string,
    args: Record<string, string>,
    taskId: string,
    progress: (text: string) => void,
  ) {
    const present = await this.runner(cli.command, ['image', 'inspect', '--format', '{{.Id}}', tag])
    if (present.code === 0) return tag
    const logs = join(this.options.root, 'logs')
    mkdirSync(logs, { recursive: true, mode: 0o700 })
    const logPath = join(logs, `image-${source.hash.slice(0, 16)}.log`)
    this.setThread(taskId, 'preparing', 'Building the sandbox image', logPath)
    const log: WriteStream = createWriteStream(logPath, { mode: 0o600 })
    const context = await writeBuildContext(source)
    try {
      progress('Building the sandbox image. The first build can take several minutes.')
      const result = await this.runner(
        cli.command,
        [
          'build',
          '--tag',
          tag,
          '--label',
          `${LABEL}.image=1`,
          ...Object.entries(args).flatMap(([name, value]) => ['--build-arg', `${name}=${value}`]),
          context.directory,
        ],
        {
          timeout: 45 * 60_000,
          onLine: (line) => {
            log.write(`${line}\n`)
            const step = line.match(/^(?:#\d+ )?\[\s*\d+\/\d+\].*|^STEP \d+\/\d+.*/)?.[0]
            if (step) {
              progress(`Building the sandbox image: ${step.slice(0, 200)}`)
              this.setThread(
                taskId,
                'preparing',
                `Building the sandbox image: ${step.slice(0, 200)}`,
                logPath,
              )
            }
          },
        },
      )
      if (result.code !== 0)
        throw new Error(
          `Building the sandbox image failed. Check the network and the container CLI, then send the message again. Full log: ${logPath}\n${tail(result.stderr || result.stdout)}`,
        )
      return tag
    } finally {
      log.end()
      await context.dispose()
    }
  }

  private async hostVersion(command: string, env: Record<string, string>, request: SandboxRequest) {
    // A command that a sandbox can change must not run on the host, not even with --version.
    const roots = await Promise.all(
      [request.cwd, ...(request.linked ?? []).map((item) => item.path)].map((path) =>
        realpath(path).catch(() => resolve(path)),
      ),
    )
    const writable = await hostCommandWritable(
      command,
      env.PATH ?? process.env.PATH,
      (path) =>
        this.records.writable(path) ||
        roots.some((root) => path === root || path.startsWith(`${root}/`)),
    )
    if (writable) return undefined
    const key = JSON.stringify([command, env.PATH ?? ''])
    const cached = this.versions.get(key)
    if (cached && cached.expires > Date.now()) return cached.value
    const value = await (this.options.hostVersion ?? defaultHostVersion)(command, env)
    this.versions.set(key, { value, expires: Date.now() + 10 * 60_000 })
    return value
  }

  /** Install a mise tool into the shared volume from a short-lived container with network
   * access, so a thread without network can still use a harness. Returns the exact tool. */
  private install(
    cli: ContainerCli,
    image: string,
    tool: string,
    version: string | undefined,
    progress: (text: string) => void,
  ) {
    const wanted = `${tool}@${version ?? 'latest'}`
    const key = `${image}\0${wanted}`
    let install = this.installs.get(key)
    if (!install) {
      install = (async () => {
        progress(`Installing ${wanted} in the sandbox`)
        const attempt = (spec: string) =>
          this.helper(cli, image, [
            'sh',
            '-c',
            tool.startsWith('pipx:')
              ? 'mise install node@lts uv@latest && UV_PYTHON_INSTALL_DIR=/mise/python UV_PYTHON=3.13 mise exec uv@latest -- mise install "$1"'
              : 'mise install node@lts && mise install "$1"',
            'sh',
            spec,
          ])
        const first = await attempt(wanted)
        if (first.code === 0) return wanted
        if (!version)
          throw new Error(`Installing ${wanted} failed:\n${tail(first.stderr || first.stdout)}`)
        // A host build can carry a version that its package registry never published.
        progress(`${wanted} is not installable. Installing the latest ${tool} instead.`)
        const latest = `${tool}@latest`
        const second = await attempt(latest)
        if (second.code !== 0)
          throw new Error(`Installing ${tool} failed:\n${tail(second.stderr || second.stdout)}`)
        return latest
      })()
      this.installs.set(key, install)
      void install.catch(() => this.installs.delete(key))
    }
    return install
  }

  private helper(cli: ContainerCli, image: string, command: string[]) {
    return this.runner(
      cli.command,
      [
        'run',
        '--rm',
        '--label',
        `${LABEL}.helper=1`,
        '--user',
        this.user,
        ...(cli.kind === 'podman' ? ['--userns=keep-id'] : []),
        '--volume',
        `${MISE_VOLUME}:/mise`,
        image,
        ...command,
      ],
      { timeout: 20 * 60_000 },
    )
  }

  /** Install an ACP Registry agent's Linux distribution at the host installation's version. */
  private async installAcp(
    cli: ContainerCli,
    image: string,
    installationId: string,
    progress: (text: string) => void,
  ) {
    if (!this.options.acpDistribution) throw new Error('ACP Registry installs are unavailable')
    const entry = await this.options.acpDistribution(installationId)
    const { distribution } = entry
    if (distribution.kind === 'binary') {
      const arch = (this.options.arch ?? process.arch) === 'arm64' ? 'aarch64' : 'x86_64'
      const directory = `/mise/acp/${entry.registryId}/${entry.version}-${arch}`
      const key = `${image}\0acp:${directory}`
      let install = this.installs.get(key)
      if (!install) {
        install = (async () => {
          progress(`Installing ${entry.registryId} ${entry.version} in the sandbox`)
          const result = await this.helper(cli, image, [
            '/opt/dovo/bin/dovo-fetch',
            distribution.value.archive,
            distribution.value.sha256 ?? '-',
            directory,
            distribution.value.cmd,
          ])
          if (result.code !== 0)
            throw new Error(
              `Installing ${entry.registryId} failed:\n${tail(result.stderr || result.stdout)}`,
            )
          return directory
        })()
        this.installs.set(key, install)
        void install.catch(() => this.installs.delete(key))
      }
      await install
      return { command: [`${directory}/${distribution.value.cmd.replace(/^\.\//, '')}`], links: [] }
    }
    const name = entry.package?.name ?? distribution.value.package
    const version = entry.package?.spec.split(/@|==/).at(-1)
    const tool = await this.install(
      cli,
      image,
      `${distribution.kind === 'npx' ? 'npm' : 'pipx'}:${name}`,
      version,
      progress,
    )
    const link = `acp-${entry.registryId}`
    return {
      command: [`/opt/dovo/harness/${link}`],
      links: [{ name: link, tool, executable: basename(name) }],
    }
  }

  private async container(
    cli: ContainerCli,
    image: string,
    request: SandboxRequest,
    mounts: Mount[],
    progress: (text: string) => void,
  ): Promise<Container> {
    const name = this.containerName(request.taskId)
    const network = request.sandbox.network ?? 'full'
    const spec = hash({
      image,
      network,
      cpus: request.sandbox.cpus,
      memory: request.sandbox.memoryMb,
      user: this.user,
      home: this.home,
    })
    const known = this.containers.get(request.taskId)
    const inspect = await this.runner(cli.command, [
      'container',
      'inspect',
      '--format',
      `{{index .Config.Labels "${LABEL}.spec"}}\t{{.State.Running}}\t{{index .Config.Labels "${LABEL}.mounts"}}`,
      name,
    ])
    const [currentSpec, running, mountLabel] =
      inspect.code === 0 ? inspect.stdout.trim().split('\t') : []
    const existing = parseMounts(mountLabel)
    // A request that needs no new mount, such as a terminal, reuses the container.
    const covered = mounts.every((mount) =>
      existing.some(
        (item) =>
          item.path === mount.path &&
          item.source === mount.source &&
          (item.readOnly === mount.readOnly || !item.readOnly),
      ),
    )
    if (inspect.code === 0 && currentSpec === spec && covered) {
      const container: Container =
        known?.spec === spec && known.mounts.length === existing.length
          ? known
          : { name, spec, mounts: existing, prepared: false, harnesses: new Set<string>() }
      if (running !== 'true') {
        progress('Starting the sandbox')
        await runChecked(this.runner, cli.command, ['start', name])
        container.prepared = false
        container.harnesses.clear()
      }
      this.containers.set(request.taskId, container)
      return container
    }
    if (inspect.code === 0) {
      // Mounts, image or limits changed, for example after a harness or linked checkout change.
      progress('Recreating the sandbox with new settings')
      await runChecked(this.runner, cli.command, ['rm', '--force', name])
    }
    progress('Creating the sandbox')
    const memory = request.sandbox.memoryMb ?? defaultContainerSandboxMemoryMb
    await runChecked(this.runner, cli.command, [
      'create',
      '--name',
      name,
      '--label',
      `${LABEL}=1`,
      '--label',
      `${LABEL}.runtime=${this.options.runtimeId}`,
      '--label',
      `${LABEL}.thread=${request.taskId}`,
      '--label',
      `${LABEL}.spec=${spec}`,
      '--label',
      `${LABEL}.mounts=${JSON.stringify(mounts)}`,
      '--hostname',
      'dovo-sandbox',
      '--security-opt',
      'no-new-privileges',
      '--pids-limit',
      '4096',
      '--memory',
      `${memory}m`,
      ...(request.sandbox.cpus ? ['--cpus', String(request.sandbox.cpus)] : []),
      ...(cli.kind === 'podman' ? ['--userns=keep-id'] : []),
      ...(network === 'none'
        ? ['--network', 'none']
        : this.socketTransport
          ? []
          : ['--add-host', 'host.docker.internal:host-gateway']),
      '--env',
      `HOME=${this.home}`,
      '--workdir',
      request.cwd,
      ...mounts.flatMap((mount) => [
        '--volume',
        `${mount.source ?? mount.path}:${mount.path}${mount.readOnly ? ':ro' : ''}`,
      ]),
      '--volume',
      `${MISE_VOLUME}:/mise`,
      image,
    ])
    await runChecked(this.runner, cli.command, ['start', name])
    const container: Container = {
      name,
      spec,
      mounts,
      prepared: false,
      harnesses: new Set<string>(),
    }
    this.containers.set(request.taskId, container)
    return container
  }

  /** Per-start setup: a writable home, the Dovo tools bundle, harness links and project tools. */
  private async setup(
    cli: ContainerCli,
    container: Container,
    request: SandboxRequest,
    installed: Array<{ name: string; tool: string; executable: string }>,
    progress: (text: string) => void,
  ) {
    const asRoot = ['exec', '-i', '--user', '0:0', container.name]
    if (!container.prepared) {
      const bundle = await (this.options.agentToolsBundle ?? readAgentToolsBundle)()
      await runChecked(
        this.runner,
        cli.command,
        [
          ...asRoot,
          'sh',
          '-c',
          [
            'set -e',
            'mkdir -p "$1" /opt/dovo/lib',
            'chown "$2" "$1"',
            `cat > ${TOOLS_PATH}`,
            `node="$(mise where node@lts)/bin/node"`,
            `printf '#!/bin/sh\\nexec "%s" ${TOOLS_PATH} "$@"\\n' "$node" > ${TOOLS_COMMAND}`,
            `chmod 0755 ${TOOLS_COMMAND}`,
          ].join('\n'),
          'sh',
          this.home,
          this.user,
        ],
        { input: bundle.toString('utf8'), timeout: 120000 },
      )
    }
    for (const item of installed) {
      const key = `${item.name}\0${item.tool}`
      if (container.harnesses.has(key)) continue
      await runChecked(this.runner, cli.command, [
        ...asRoot,
        '/opt/dovo/bin/dovo-link-tool',
        item.name,
        item.tool,
        item.executable,
      ])
      container.harnesses.add(key)
    }
    if (!container.prepared) {
      // The checkout's own tools. A failure is reported but does not block the thread: the
      // agent can fix the configuration or run `mise use` itself.
      progress('Installing the project tools with mise')
      const lines: string[] = []
      const result = await this.runner(
        cli.command,
        [
          'exec',
          '--user',
          this.user,
          '--workdir',
          request.cwd,
          container.name,
          '/opt/dovo/bin/dovo-prepare-project',
          request.cwd,
        ],
        {
          timeout: 30 * 60_000,
          onLine: (line) => {
            lines.push(line)
            progress(`mise: ${line.slice(0, 200)}`)
          },
        },
      )
      container.projectWarning =
        result.code === 0
          ? undefined
          : `mise could not install this project's tools${request.sandbox.network === 'none' ? ' (the sandbox has no network)' : ''}:\n${tail(lines.join('\n'), 15)}`
      container.prepared = true
    }
  }

  /** A Unix socket in the thread's state directory that forwards to the runtime's loopback
   * listener. Requests through it still need the run credential. */
  private async socket(taskId: string, state: string) {
    if (this.sockets.has(taskId)) return
    const tools = this.options.taskTools()
    if (!tools) return
    const path = join(state, 'dovo.sock')
    rmSync(path, { force: true })
    const host = tools.host === '0.0.0.0' || tools.host === '::' ? '127.0.0.1' : tools.host
    const server = createServer((client) => {
      const upstream = connect(tools.port, host)
      client.pipe(upstream).pipe(client)
      client.on('error', () => upstream.destroy())
      upstream.on('error', () => client.destroy())
    })
    await new Promise<void>((resolvePromise, reject) => {
      server.once('error', reject)
      server.listen(path, resolvePromise)
    })
    server.unref()
    this.sockets.set(taskId, server)
  }

  /** Remove a thread's container and state. Used when the thread is archived or deleted. */
  async remove(taskId: string) {
    clearTimeout(this.idle.get(taskId))
    this.idle.delete(taskId)
    this.sockets.get(taskId)?.close()
    this.sockets.delete(taskId)
    this.containers.delete(taskId)
    this.sessions.delete(taskId)
    this.leases.delete(taskId)
    if (this.threads.delete(taskId)) this.changed()
    if (this.cli) {
      const result = await this.runner(this.cli.command, [
        'rm',
        '--force',
        this.containerName(taskId),
      ])
      if (result.code !== 0 && !/No such container|no container with name/i.test(result.stderr))
        throw new Error(`Could not remove the sandbox: ${tail(result.stderr, 3)}`)
    }
    await rm(this.stateDirectory(taskId), { recursive: true, force: true })
    await rm(this.homesDirectory(taskId), { recursive: true, force: true })
  }

  /** On startup: remove containers whose thread is gone or archived, and stop the rest. Their
   * processes belonged to the previous runtime process. */
  async reconcile() {
    if (this.options.threadExists) this.records.prune(this.options.threadExists)
    // A runtime that never ran a sandbox has nothing to reconcile and runs no container CLI.
    if (!existsSync(join(this.options.root, 'threads'))) return
    await this.detect()
    const cli = this.cli
    if (!cli) return
    const listed = await runChecked(this.runner, cli.command, [
      'ps',
      '--all',
      '--filter',
      `label=${LABEL}.runtime=${this.options.runtimeId}`,
      '--format',
      `{{.Names}}\t{{.Label "${LABEL}.thread"}}\t{{.State}}`,
    ])
    for (const line of listed.stdout.split('\n')) {
      const [name, taskId, state] = line.trim().split('\t')
      if (!name || !taskId) continue
      if (!this.options.keepThread(taskId)) {
        await this.remove(taskId).catch((error: unknown) =>
          console.error('Could not remove orphaned sandbox', name, error),
        )
        continue
      }
      if (state === 'running')
        await runChecked(this.runner, cli.command, ['stop', '--time', '5', name]).catch(
          (error: unknown) =>
            console.error('Could not stop sandbox from a previous runtime', name, error),
        )
      this.setThread(taskId, 'stopped')
    }
  }

  async dispose() {
    for (const timer of this.idle.values()) clearTimeout(timer)
    this.idle.clear()
    for (const server of this.sockets.values()) server.close()
    this.sockets.clear()
  }
}
