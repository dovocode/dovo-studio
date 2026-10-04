import { homedir } from 'node:os'
import { relative, isAbsolute, delimiter, join, resolve, dirname } from 'node:path'
import { access, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { CopilotClient, RuntimeConnection } from '@github/copilot-sdk'
import type { SessionConfig, MCPServerConfig, PermissionHandler } from '@github/copilot-sdk'
import { Schema } from 'effect'
import { decode, questionPromptSchema } from '@dovo/protocol'
import type { AgentDiscovery } from '@dovo/protocol'
import type { AgentAdapter, AgentRun } from '../../execution/types.js'
import { processEnvironment } from '../../../process.js'
import { mcpHeaders, mcpServerEnvironment } from '../../configuration/mcp-settings.js'
import { nativeWait } from '../shared/native.js'

export async function copilotExecutable(command: string, env: NodeJS.ProcessEnv, cwd: string) {
  const explicit = isAbsolute(command) || command.includes('/') || command.includes('\\')
  const extensions =
    process.platform === 'win32' && !/\.[^\\/]+$/.test(command)
      ? ['', ...(env.PATHEXT || '.EXE;.CMD;.BAT').split(';')]
      : ['']
  for (const directory of explicit ? [''] : (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = explicit ? resolve(cwd, command) : join(directory, command + extension)
      try {
        await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
        return candidate
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            'code' in error &&
            ['ENOENT', 'ENOTDIR', 'EACCES'].includes(String(error.code))
          )
        )
          throw error
      }
    }
  }
  throw new Error('Copilot CLI not found. Install it on this runtime or set its executable path.')
}
async function workspaceWrite(run: AgentRun, path: string) {
  const root = await realpath(run.cwd)
  const target = resolve(run.cwd, path)
  let actual: string
  try {
    actual = await realpath(target)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    try {
      actual = await realpath(dirname(target))
    } catch (parentError) {
      if (parentError instanceof Error && 'code' in parentError && parentError.code === 'ENOENT')
        return false
      throw parentError
    }
  }
  const value = relative(root, actual)
  return (
    value !== '..' && !value.startsWith('../') && !value.startsWith('..\\') && !isAbsolute(value)
  )
}
async function clientFor(agent: AgentDiscovery, cwd: string) {
  return new CopilotClient({
    connection: RuntimeConnection.forStdio({
      path: await copilotExecutable(
        agent.endpoint || 'copilot',
        processEnvironment(agent.env),
        cwd,
      ),
      args: agent.args,
      env: Object.fromEntries(
        Object.entries(processEnvironment(agent.env)).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
    }),
    workingDirectory: cwd,
    baseDirectory: agent.configDirectory || undefined,
    mode: 'copilot-cli',
  })
}
async function close(client: CopilotClient) {
  const signal = new AbortController().signal
  try {
    const errors = await nativeWait(client.stop(), signal, 10000)
    if (errors.length) throw new AggregateError(errors, 'Could not cleanly stop Copilot')
  } catch (error) {
    try {
      await nativeWait(client.forceStop(), signal, 10000)
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'Could not stop Copilot')
    }
    throw error
  }
}
export const copilotPermission =
  (run: AgentRun, signal: AbortSignal): PermissionHandler =>
  async (request) => {
    if (signal.aborted || run.tools === 'none') return { kind: 'reject' }
    const automatic =
      !request.managedApprovalRequired &&
      (run.agent.permission === 'full-access' ||
        request.kind === 'read' ||
        (run.agent.permission === 'workspace-write' &&
          request.kind === 'write' &&
          (await workspaceWrite(run, request.fileName))))
    if (run.agent.permission === 'read-only' && !automatic) return { kind: 'reject' }
    const approved =
      automatic ||
      (await nativeWait(
        run.approve(`Copilot ${request.kind} request`, JSON.stringify(request)),
        signal,
      ))
    return signal.aborted || !approved
      ? { kind: 'reject' }
      : { kind: 'approve-once', approvedInteractively: !automatic }
  }
function configuration(run: AgentRun, signal: AbortSignal): SessionConfig {
  const mcpServers: Record<string, MCPServerConfig> = {}
  if (run.tools !== 'none')
    for (const server of run.agent.resources?.mcpServers ?? []) {
      if (!server.enabled) continue
      mcpServers[server.name] =
        server.transport === 'stdio'
          ? {
              type: 'stdio',
              command: server.command,
              args: server.args,
              env: mcpServerEnvironment(server),
            }
          : { type: 'http', url: server.url, headers: mcpHeaders(server) }
    }
  const effort = run.agent.reasoning
    ? decode(Schema.Literal('low', 'medium', 'high', 'xhigh'), run.agent.reasoning)
    : undefined
  return {
    model: run.agent.model || undefined,
    reasoningEffort: effort,
    streaming: true,
    workingDirectory: run.cwd,
    mcpServers,
    ...(run.tools === 'none'
      ? {
          availableTools: [],
          excludedTools: ['builtin:*', 'mcp:*', 'custom:*'],
          enableConfigDiscovery: false,
        }
      : {}),
    systemMessage: run.agent.instructions
      ? { mode: 'append', content: run.agent.instructions }
      : undefined,
    onPermissionRequest: copilotPermission(run, signal),
    onUserInputRequest: async (request) => {
      const answers = await run.ask(
        decode(questionPromptSchema, {
          title: 'Copilot needs your input',
          questions: [
            {
              id: 'answer',
              header: 'Question',
              question: request.question,
              options: (request.choices ?? []).map((label) => ({ value: label, label })),
              custom: request.allowFreeform !== false,
              multiple: false,
            },
          ],
        }),
        signal,
      )
      if (!answers || signal.aborted) throw new Error('Copilot input request cancelled')
      const answer = answers.answer?.[0] ?? ''
      return { answer, wasFreeform: !request.choices?.includes(answer) }
    },
  }
}
export function createCopilotAdapter(): AgentAdapter {
  return {
    async models(agent) {
      const client = await clientFor(agent, homedir())
      try {
        const signal = new AbortController().signal
        await nativeWait(client.start(), signal, 30000)
        const rows = await nativeWait(client.listModels(), signal, 30000)
        return {
          models: rows.map((row) => ({
            id: row.id,
            name: row.name,
            defaultReasoning: row.defaultReasoningEffort,
            reasoning: (row.supportedReasoningEfforts ?? []).map((id) => ({ id, name: id })),
            hidden: row.policy?.state === 'disabled',
          })),
          reasoning: [...new Set(rows.flatMap((row) => row.supportedReasoningEfforts ?? []))].map(
            (id) => ({ id, name: id }),
          ),
        }
      } finally {
        await close(client)
      }
    },
    async probe(agent) {
      let client: CopilotClient | undefined
      try {
        client = await clientFor(agent, homedir())
        const signal = new AbortController().signal
        await nativeWait(client.start(), signal, 30000)
        const auth = await nativeWait(client.getAuthStatus(), signal, 30000)
        return {
          provider: 'copilot',
          available: auth.isAuthenticated,
          detail: auth.isAuthenticated
            ? 'Copilot CLI is authenticated.'
            : 'Sign in with copilot login on this runtime.',
        }
      } catch (error) {
        return {
          provider: 'copilot',
          available: false,
          detail: error instanceof Error ? error.message : String(error),
        }
      } finally {
        if (client) await close(client)
      }
    },
    async run(run) {
      run.signal.throwIfAborted()
      const lifetime = new AbortController(),
        signal = AbortSignal.any([run.signal, lifetime.signal])
      const client = await clientFor(run.agent, run.cwd)
      let session: Awaited<ReturnType<CopilotClient['createSession']>> | undefined
      let unsubscribe: (() => void) | undefined,
        heartbeat: ReturnType<typeof setInterval> | undefined
      let checking = false,
        active = false
      let resolve: () => void = () => {},
        reject: (error: unknown) => void = () => {}
      const idle = new Promise<void>((yes) => {
        resolve = yes
      })
      const failed = new Promise<never>((_, no) => {
        reject = no
      })
      const completed = Promise.race([idle, failed])
      void completed.catch(() => {})
      const parts = new Map<string, string>()
      let current = ''
      const boundary = (id: string) => {
        if (current && current !== id) run.onTextBoundary?.()
        current = id
      }
      try {
        await nativeWait(client.start(), signal, 30000)
        const config = configuration(run, signal)
        session = await nativeWait(
          run.sessionId
            ? client.resumeSession(run.sessionId, config)
            : client.createSession(config),
          signal,
          30000,
        )
        const owned = session
        run.onSession(owned.sessionId)
        unsubscribe = owned.on((event) => {
          if (!active || signal.aborted) return
          try {
            // The SDK catches listener exceptions, so persistence failures must reject our turn.
            run.onEvent?.(event.type, event.data)
            if (event.agentId || ('parentToolCallId' in event.data && event.data.parentToolCallId))
              return
            if (event.type === 'assistant.message_delta') {
              boundary(event.data.messageId)
              parts.set(
                event.data.messageId,
                (parts.get(event.data.messageId) ?? '') + event.data.deltaContent,
              )
              run.onText(event.data.deltaContent)
            }
            if (event.type === 'assistant.message') {
              boundary(event.data.messageId)
              const previous = parts.get(event.data.messageId) ?? ''
              if (!event.data.content.startsWith(previous))
                throw new Error('Copilot replaced streamed message text')
              run.onText(event.data.content.slice(previous.length))
              parts.set(event.data.messageId, event.data.content)
            }
            if (event.type === 'tool.execution_start')
              run.onActivity(`Using ${event.data.toolName}`)
            if (event.type === 'session.error') reject(new Error(event.data.message))
            if (event.type === 'session.idle') resolve()
          } catch (error) {
            reject(error)
          }
        })
        // The SDK exposes no public disconnect event for this subscription. Ping detects a lost host without putting a deadline on model work.
        heartbeat = setInterval(() => {
          if (checking || !active || signal.aborted) return
          checking = true
          void nativeWait(client.ping(), signal, 30000)
            .catch(reject)
            .finally(() => {
              checking = false
            })
        }, 5000)
        active = true
        if (run.compact) {
          const result = await nativeWait(
            Promise.race([owned.rpc.history.compact(), failed]),
            signal,
          )
          if (!result.success) throw new Error('Copilot did not complete context compaction')
          run.onEvent?.('dovo/compaction/completed', { sessionId: owned.sessionId })
        } else {
          const message = (input: { prompt: string; attachments?: AgentRun['attachments'] }) => ({
            prompt: input.prompt,
            attachments: input.attachments?.map((file) => ({
              type: 'file' as const,
              path: file.path,
            })),
          })
          await nativeWait(owned.send(message(run)), signal, 30000)
          run.onPromptAccepted?.()
          run.onSteer?.(async (input) => {
            if (!active || signal.aborted) throw new Error('This Copilot turn has ended')
            await nativeWait(owned.send({ ...message(input), mode: 'immediate' }), signal, 30000)
          })
          await nativeWait(completed, signal)
        }
      } finally {
        active = false
        lifetime.abort()
        clearInterval(heartbeat)
        unsubscribe?.()
        run.onSteer?.(undefined)
        try {
          if (run.signal.aborted && session)
            await nativeWait(session.abort(), new AbortController().signal, 2000).catch((error) =>
              run.onActivity(
                `Copilot interrupt: ${error instanceof Error ? error.message : String(error)}`,
              ),
            )
          if (run.ephemeral && session)
            await nativeWait(
              client.deleteSession(session.sessionId),
              new AbortController().signal,
              30000,
            )
        } finally {
          await close(client)
        }
      }
    },
  }
}
