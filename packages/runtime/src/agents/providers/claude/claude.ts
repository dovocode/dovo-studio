import { claudeLaunchFlags } from '../../configuration/launch-flags.js'
import { claudeCommand } from '../../configuration/claude-command.js'
import { decode } from '@dovo/protocol'
import { claudeMcpServers } from '../../configuration/mcp-settings.js'
import { claudeInput, claudeMessage } from './claude-input.js'
import { Schema } from 'effect'
import { claudeModels } from '../../catalogs/claude.js'
import { claudeQuestions } from './claude-questions.js'
import { formQuestions } from '../shared/form-questions.js'
import { query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentAdapter, AgentRun } from '../../execution/types.js'
import { executableAvailable, processEnvironment } from '../../../process.js'
import { releaseIdleProvider } from '../../execution/warm-processes.js'
function claudeStream(
  run: AgentRun,
  controller: AbortController,
  prompt: string | AsyncIterable<SDKUserMessage>,
  activeRun: () => AgentRun,
  command: string,
) {
  return query({
    prompt,
    options: {
      cwd: run.cwd,
      env: processEnvironment(run.agent.env),
      extraArgs: claudeLaunchFlags(run.agent.args),
      abortController: controller,
      ...(run.sessionId
        ? {
            resume: run.sessionId,
          }
        : {}),
      ...(run.agent.model
        ? {
            model: run.agent.model,
          }
        : {}),
      ...(run.agent.reasoning
        ? {
            effort: decode(
              Schema.Literal('low', 'medium', 'high', 'xhigh', 'max'),
              run.agent.reasoning,
            ),
          }
        : {}),
      pathToClaudeCodeExecutable: command,
      ...(run.ephemeral ? { persistSession: false } : {}),
      systemPrompt:
        run.tools === 'none'
          ? run.agent.instructions
          : {
              type: 'preset',
              preset: 'claude_code',
              append: run.agent.instructions,
            },
      permissionMode:
        run.agent.permission === 'full-access'
          ? 'bypassPermissions'
          : run.agent.permission === 'auto'
            ? 'auto'
            : run.agent.permission === 'workspace-write'
              ? 'acceptEdits'
              : 'default',
      ...(run.agent.permission === 'full-access'
        ? {
            allowDangerouslySkipPermissions: true,
          }
        : {}),
      ...(run.tools === 'none'
        ? {
            tools: [],
            strictMcpConfig: true,
            mcpServers: {},
          }
        : run.agent.resources?.mcpServers.length
          ? {
              mcpServers: claudeMcpServers(run.agent.resources.mcpServers),
            }
          : {}),
      // Coding sessions inherit Claude settings; text-only utilities stay isolated.
      settingSources: run.tools === 'none' ? [] : ['user', 'project', 'local'],
      includePartialMessages: true,
      onElicitation: async (request, options) => {
        if (request.mode !== 'form' && request.mode !== undefined) {
          activeRun().onActivity('This Claude MCP input request is not a supported form')
          return {
            action: 'cancel',
          }
        }
        const content = await formQuestions(
          request.message,
          request.requestedSchema,
          activeRun(),
          options.signal,
        )
        return content
          ? {
              action: 'accept',
              content,
            }
          : {
              action: 'decline',
            }
      },
      ...(run.tools !== 'none' && run.agent.permission === 'read-only'
        ? {
            tools: ['Read', 'Glob', 'Grep', 'AskUserQuestion'],
          }
        : {}),
      canUseTool: async (name, input, options) => {
        if (run.tools === 'none')
          return {
            behavior: 'deny',
            message: 'Tools are disabled for text cleanup',
          }
        if (name === 'AskUserQuestion') return claudeQuestions(input, activeRun(), options.signal)
        const allowed =
          activeRun().agent.permission === 'read-only'
            ? ['Read', 'Glob', 'Grep'].includes(name)
            : await activeRun().approve(name, JSON.stringify(input, null, 2))
        return allowed
          ? {
              behavior: 'allow',
              updatedInput: input,
            }
          : {
              behavior: 'deny',
              message: 'Permission denied in Dovo Studio',
            }
      },
    },
  })
}
function handleMessage(run: AgentRun, message: SDKMessage, compacted: () => void) {
  if (message.type === 'system' && message.subtype === 'compact_boundary') compacted()
  if (message.type === 'assistant' || message.type === 'stream_event' || message.type === 'result')
    run.onPromptAccepted?.()
  run.onEvent?.(message.type, message)
  if (message.session_id) run.onSession(message.session_id)
  if (
    message.type === 'stream_event' &&
    message.event.type === 'content_block_delta' &&
    message.event.delta.type === 'text_delta'
  )
    run.onText(message.event.delta.text)
  if (message.type === 'assistant')
    for (const block of message.message.content)
      if (block.type === 'tool_use') run.onActivity(block.name)
  if (message.type === 'result' && message.subtype !== 'success')
    throw new Error(message.errors.join('\n'))
  if (message.type === 'result' && message.subtype === 'success' && message.is_error)
    throw new Error(message.result)
}
class MessageQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = []
  private wake: (() => void) | undefined
  private closed = false
  push(message: SDKUserMessage) {
    if (this.closed) throw new Error('Claude input stream is closed')
    this.items.push(message)
    this.wake?.()
  }
  close() {
    this.closed = true
    this.wake?.()
  }
  async *[Symbol.asyncIterator]() {
    while (!this.closed || this.items.length) {
      if (this.items.length) {
        const next = this.items.shift()
        if (next) yield next
      } else await new Promise<void>((resolve) => (this.wake = resolve))
      this.wake = undefined
    }
  }
}
type WarmTurn = {
  run: AgentRun
  compacted: boolean
  resolve: () => void
  reject: (error: Error) => void
}
type WarmClaude = {
  stream: ReturnType<typeof query>
  input: MessageQueue
  controller: AbortController
  turn?: WarmTurn
  sessionId?: string
  cwd: string
  command: string
  config: string
  taskId: string
  consumer: Promise<void>
  closed: boolean
  closing?: Promise<void>
}

export function createClaudeAdapter(): AgentAdapter {
  const idle = new Map<string, WarmClaude>()
  const active = new Set<WarmClaude>()
  const close = (session: WarmClaude): Promise<void> => {
    if (session.closing) return session.closing
    idle.delete(session.taskId)
    active.delete(session)
    session.closed = true
    session.input.close()
    session.closing = (async () => {
      let closeError: unknown
      try {
        session.stream.close()
      } catch (error) {
        closeError = error
      } finally {
        session.controller.abort()
      }
      await session.consumer.catch(() => {})
      if (closeError) throw closeError
    })()
    return session.closing
  }
  const runWarm = async (run: AgentRun, command: string) => {
    if (!run.taskId) throw new Error('Warm Claude turn needs a task')
    const config = JSON.stringify([run.agent, run.tools])
    const previous = idle.get(run.taskId)
    idle.delete(run.taskId)
    const reusable =
      previous &&
      previous.sessionId === run.sessionId &&
      previous.cwd === run.cwd &&
      previous.command === command &&
      previous.config === config &&
      !previous.closed &&
      !previous.controller.signal.aborted
        ? previous
        : undefined
    if (previous && !reusable) await close(previous)
    let session: WarmClaude
    if (reusable) session = reusable
    else {
      const input = new MessageQueue()
      const controller = new AbortController()
      // The callback reads the current turn, so an idle provider cannot authorize tools.
      const currentRun = () => {
        if (!session.turn) throw new Error('Claude has no active turn')
        return session.turn.run
      }
      const stream = claudeStream(run, controller, input, currentRun, command)
      session = {
        stream,
        input,
        controller,
        cwd: run.cwd,
        command,
        config,
        taskId: run.taskId,
        sessionId: run.sessionId,
        consumer: Promise.resolve(),
        closed: false,
      }
      active.add(session)
      session.consumer = (async () => {
        try {
          for await (const message of stream) {
            const turn = session.turn
            if (!turn) continue
            if (message.session_id) session.sessionId = message.session_id
            try {
              handleMessage(turn.run, message, () => (turn.compacted = true))
              if (message.type === 'result') {
                if (turn.run.compact && !turn.compacted)
                  throw new Error('Claude did not report a completed compaction')
                session.turn = undefined
                turn.resolve()
              }
            } catch (error) {
              session.turn = undefined
              turn.reject(error instanceof Error ? error : new Error(String(error)))
              throw error
            }
          }
          throw new Error('Claude connection ended')
        } catch (error) {
          session.turn?.reject(error instanceof Error ? error : new Error(String(error)))
          session.turn = undefined
          session.closed = true
          active.delete(session)
          idle.delete(session.taskId)
          session.input.close()
          try {
            stream.close()
          } catch (closeError) {
            console.error('Could not close Claude stream:', closeError)
          }
        }
      })()
      void session.consumer.catch((error) => console.error('Claude stream failed:', error))
    }
    const completion = new Promise<void>((resolve, reject) => {
      session.turn = { run, compacted: false, resolve, reject }
    })
    const abort = () => {
      session.turn?.reject(new Error('Task cancelled'))
      void close(session).catch((error) => console.error('Could not stop Claude:', error))
    }
    run.signal.addEventListener('abort', abort, { once: true })
    try {
      run.signal.throwIfAborted()
      session.input.push(claudeMessage(run))
      const accountInfo =
        typeof session.stream.accountInfo === 'function'
          ? session.stream.accountInfo().catch((error) => {
              console.warn(
                'Claude account metadata unavailable:',
                error instanceof Error ? error.message : String(error),
              )
              return undefined
            })
          : Promise.resolve(undefined)
      // Observe both promises immediately, so a failed turn cannot become an unhandled rejection while metadata is loading.
      await Promise.all([
        completion,
        accountInfo.then((account) => {
          const env = processEnvironment(run.agent.env)
          if (account && !env.ANTHROPIC_AUTH_TOKEN && !env.ANTHROPIC_API_KEY)
            run.onEvent?.('account/info', account)
        }),
      ])
      if (session.sessionId && !session.closed && !session.controller.signal.aborted) {
        idle.set(run.taskId, session)
        if (releaseIdleProvider()) {
          const oldest = idle.values().next().value
          if (oldest)
            await close(oldest).catch((error) =>
              console.error('Could not release idle Claude process:', error),
            )
        }
      } else await close(session)
    } catch (error) {
      await close(session)
      throw error
    } finally {
      run.signal.removeEventListener('abort', abort)
    }
  }
  return {
    models: claudeModels,
    probe: async (agent) => ({
      provider: 'claude',
      available: await executableAvailable(agent.endpoint || 'claude'),
      detail:
        'Requires Claude CLI installed on this runtime host (claude on PATH or a configured executable). Uses the host’s Claude login or ANTHROPIC_API_KEY.',
    }),
    async run(run) {
      const command = await claudeCommand(run.agent.endpoint)
      if (run.taskId && run.tools !== 'none') return runWarm(run, command)
      const controller = new AbortController(),
        abort = () => controller.abort()
      run.signal.addEventListener('abort', abort, {
        once: true,
      })
      if (run.signal.aborted) abort()
      const stream = claudeStream(
        run,
        controller,
        run.attachments?.length ? claudeInput(run) : run.prompt,
        () => run,
        command,
      )
      try {
        let compacted = false
        for await (const message of stream) {
          handleMessage(run, message, () => (compacted = true))
        }
        if (run.compact && !compacted)
          throw new Error('Claude did not report a completed compaction')
      } finally {
        run.signal.removeEventListener('abort', abort)
        stream.close()
      }
    },
    dispose: async () => {
      await Promise.all([...active].map(close))
    },
  }
}
export const claudeAdapter = createClaudeAdapter()
