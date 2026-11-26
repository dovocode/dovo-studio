import { sandboxRun } from '../../sandbox/run.js'
import { homedir } from 'node:os'
import type { ManagedPolicy } from '../../policy/managed-policy.js'
import { SecretReferences } from './secret-references.js'
import { isAbsolute, join } from 'node:path'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { Effect } from 'effect'
import { runtimeOperation, runtimeFailure } from '../../errors.js'
import { decode } from '@dovo/protocol'
import { ExtensionHost, runClientEffect } from '@dovo/client-runtime'
import { commandsSchema, type CommandSettings, type AgentDiscovery } from '@dovo/protocol'
import type { Agent } from '@dovo/protocol'
import type { AcpLaunch, AgentAdapter } from '../execution/types.js'
import type { SandboxSession } from '../../sandbox/launcher.js'
const expandHome = (path: string) =>
  path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path

const sandboxWritableDetail = (command: string) =>
  `Dovo did not run ${command} to check it, because a sandboxed thread can change that file. Dovo still starts it when a thread uses this agent.`

export class AgentRegistry {
  readonly secretReferences = new SecretReferences()
  get secretGeneration() {
    return this.secretReferences.generation
  }
  private adapters = new Map<Agent['provider'], AgentAdapter>()
  readonly host = new ExtensionHost()
  constructor(
    private settings: () => CommandSettings = () => decode(commandsSchema, {}),
    private acpLaunch?: (id: string) => AcpLaunch,
    private policy?: ManagedPolicy,
    readonly refreshPath?: () => Promise<void>,
  ) {
    const providers = [
      ['vibe', () => import('../providers/vibe/vibe.js').then((m) => m.createVibeAdapter())],
      ['codex', () => import('../providers/codex/codex.js').then((m) => m.createCodexAdapter())],
      ['pi', () => import('../providers/pi/pi.js').then((m) => m.createPiAdapter())],
      [
        'opencode',
        () => import('../providers/opencode/opencode.js').then((m) => m.createOpenCodeAdapter()),
      ],
      [
        'claude',
        () => import('../providers/claude/claude.js').then((m) => m.createClaudeAdapter()),
      ],
      [
        'hermes',
        () => import('../providers/hermes/hermes.js').then((m) => m.createHermesAdapter()),
      ],
      [
        'copilot',
        () => import('../providers/copilot/copilot.js').then((m) => m.createCopilotAdapter()),
      ],
      ['grok', () => import('../providers/grok/grok.js').then((m) => m.createGrokAdapter())],
      ['muse', () => import('../providers/muse/muse.js').then((m) => m.createMuseAdapter())],
      [
        'cursor',
        () => import('../providers/cursor/cursor.js').then((m) => m.createCursorAdapter()),
      ],
      ['acp', () => import('../providers/acp/acp.js').then((m) => m.createAcpAdapter())],
    ] as const
    for (const [id, load] of providers)
      this.host.register({
        manifest: {
          id: `dovo.provider.${id}`,
          name: id,
          version: '0.1.0',
          activationEvents: [`onCommand:agent.${id}.run`],
        },
        activate: (context) =>
          Effect.gen({ self: this }, function* () {
            this.adapters.set(id, yield* runtimeOperation(load))
            context.subscriptions.push({
              dispose: () => {
                this.adapters.delete(id)
              },
            })
          }),
      })
  }
  configure<T extends AgentDiscovery>(agent: T): T {
    agent = this.policy?.configure(agent) ?? agent
    if (agent.provider === 'cursor') return { ...agent, endpoint: '' }
    return {
      ...agent,
      ...(agent.configDirectory ? { configDirectory: expandHome(agent.configDirectory) } : {}),
      ...(agent.configDirectory &&
      (agent.provider === 'codex' ||
        agent.provider === 'claude' ||
        agent.provider === 'hermes' ||
        agent.provider === 'pi' ||
        agent.provider === 'vibe')
        ? {
            env: {
              ...agent.env,
              [agent.provider === 'pi'
                ? 'PI_CODING_AGENT_DIR'
                : agent.provider === 'vibe'
                  ? 'VIBE_HOME'
                  : agent.provider === 'hermes'
                    ? 'HERMES_HOME'
                    : agent.provider === 'codex'
                      ? 'CODEX_HOME'
                      : 'CLAUDE_CONFIG_DIR']: expandHome(agent.configDirectory),
            },
          }
        : {}),
      endpoint: expandHome(
        (agent.provider !== 'opencode' ? agent.executablePath : undefined) ||
          agent.endpoint ||
          (agent.provider === 'hermes' ? agent.env?.HERMES_PYTHON : undefined) ||
          (agent.provider === 'opencode' ? '' : this.settings()[agent.provider]),
      ),
    }
  }
  authorize(agent: Agent) {
    return this.policy?.agent(agent) ?? agent
  }
  launch(agent: AgentDiscovery): AcpLaunch | undefined {
    if (agent.provider !== 'acp' || !agent.acpInstallationId) return undefined
    if (!this.acpLaunch) throw new Error('Managed ACP installations are unavailable')
    const launch = this.acpLaunch(agent.acpInstallationId)
    return {
      command: expandHome(agent.executablePath || launch.command),
      args: [...launch.args, ...(agent.args ?? [])],
      env: { ...launch.env, ...agent.env },
    }
  }
  getEffect(provider: Agent['provider']) {
    return Effect.gen({ self: this }, function* () {
      yield* this.host.activateEffect(`dovo.provider.${provider}`)
      const adapter = this.adapters.get(provider)
      if (!adapter)
        return yield* Effect.fail(runtimeFailure(new Error('Provider failed to activate')))
      const models = adapter.models
      const readNativeThread = adapter.readNativeThread
      const nativeSkills = adapter.nativeSkills
      const recoveredSessionIdle = adapter.recoveredSessionIdle
      const cursorRunCheckpointed = adapter.cursorRunCheckpointed
      return {
        ...(nativeSkills
          ? {
              nativeSkills: async (agent: Agent, cwd: string, signal: AbortSignal) => {
                const resolved = await this.secretReferences.resolve(this.configure(agent), signal)
                const launch = this.launch(resolved)
                const blocked = await this.sandboxWritableCommand(resolved, launch)
                if (blocked) throw new Error(sandboxWritableDetail(blocked))
                return nativeSkills(resolved, cwd, signal)
              },
            }
          : {}),
        ...(cursorRunCheckpointed
          ? {
              cursorRunCheckpointed: (
                agent: Agent,
                cwd: string,
                sessionId: string,
                runId: string,
                signal: AbortSignal,
              ) =>
                this.secretReferences
                  .resolve(this.configure(agent), signal)
                  .then((resolved) =>
                    cursorRunCheckpointed(resolved, cwd, sessionId, runId, signal),
                  ),
            }
          : {}),
        ...(recoveredSessionIdle
          ? {
              recoveredSessionIdle: (
                agent: Agent,
                sessionId: string,
                workerIds: readonly string[],
                cwd: string,
                signal: AbortSignal,
              ) =>
                this.secretReferences
                  .resolve(this.configure(agent), signal)
                  .then((resolved) =>
                    recoveredSessionIdle(resolved, sessionId, workerIds, cwd, signal),
                  ),
            }
          : {}),
        ...(readNativeThread
          ? {
              readNativeThread: async (
                agent: Agent,
                id: string,
                sessionId: string | undefined,
                cwd?: string,
                sandbox?: SandboxSession,
              ) => {
                const configured = this.configure(agent)
                const resolved = await this.secretReferences.resolve(configured)
                let launch: AcpLaunch | undefined
                try {
                  launch = this.launch(resolved)
                } catch {
                  // A removed managed installation has no authoritative profile to read.
                  return undefined
                }
                return readNativeThread(resolved, id, sessionId, cwd, sandbox, launch)
              },
            }
          : {}),
        run: async (run) => {
          const managed = this.policy?.agent(run.agent) ?? run.agent
          const agent = await this.secretReferences.resolve(this.configure(managed), run.signal)
          const acpLaunch = this.launch(agent)
          if (!run.prepareSandbox) return adapter.run({ ...run, agent, acpLaunch })
          const sandbox = await run.prepareSandbox(agent, acpLaunch)
          run.signal.throwIfAborted()
          return adapter.run(await sandboxRun({ ...run, agent, acpLaunch }, sandbox))
        },
        probe: (agent) => {
          const configured = this.configure(agent)
          this.launch(configured)
          return this.secretReferences.resolve(configured).then(async (resolved) => {
            const launch = this.launch(resolved)
            const blocked = await this.sandboxWritableCommand(resolved, launch)
            if (!blocked) return adapter.probe(resolved, launch)
            return {
              provider: resolved.provider,
              // Only a file check: the command itself does not run.
              available:
                !isAbsolute(blocked) ||
                (await access(blocked, constants.X_OK).then(
                  () => true,
                  () => false,
                )),
              detail: sandboxWritableDetail(blocked),
            }
          })
        },
        ...(models
          ? {
              models: (agent: AgentDiscovery) => {
                const configured = this.configure(agent)
                this.launch(configured)
                return this.secretReferences.resolve(configured).then(async (resolved) => {
                  const launch = this.launch(resolved)
                  const blocked = await this.sandboxWritableCommand(resolved, launch)
                  if (blocked) throw new Error(sandboxWritableDetail(blocked))
                  return models(resolved, launch)
                })
              },
            }
          : {}),
      } satisfies AgentAdapter
    })
  }
  private hostCommandWritable?: (
    command: string,
    env: Readonly<Record<string, string | undefined>>,
  ) => Promise<boolean>
  /** Container sandboxes report the commands that a sandboxed agent can change. */
  setHostCommandGuard(
    guard: (command: string, env: Readonly<Record<string, string | undefined>>) => Promise<boolean>,
  ) {
    this.hostCommandWritable = guard
  }
  /** The configured command when a sandboxed agent can change it. Availability checks and
   * model discovery must not run it on the host. */
  private async sandboxWritableCommand(agent: AgentDiscovery, launch?: AcpLaunch) {
    const command = launch?.command || agent.endpoint
    if (!command || !this.hostCommandWritable) return undefined
    return (await this.hostCommandWritable(command, { ...agent.env, ...launch?.env }))
      ? command
      : undefined
  }
  get(provider: Agent['provider']) {
    return runClientEffect(this.getEffect(provider))
  }
  async releaseTask(taskId: string) {
    const results = await Promise.allSettled(
      [...this.adapters.values()].map(async (adapter) => adapter.releaseTask?.(taskId)),
    )
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    if (failures.length) throw new AggregateError(failures, 'Could not release task providers')
  }
  async dispose() {
    const secrets = await Promise.allSettled([this.secretReferences.close()])
    const adapters = [...this.adapters.values()]
    const results = await Promise.allSettled(adapters.map(async (adapter) => adapter.dispose?.()))
    const host = await Promise.allSettled([this.host.dispose()])
    const failures = [...secrets, ...results, ...host].flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    if (failures.length) throw new AggregateError(failures, 'Could not close all agent providers')
  }
}
