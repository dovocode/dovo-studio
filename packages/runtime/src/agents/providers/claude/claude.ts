import { spawn } from 'node:child_process'
import { stopOwnedChild } from '../../execution/stop-owned-child.js'
import { checkedPolicyRun, toolPolicyDisposition } from '../shared/permission-policy.js'
import { randomUUID } from 'node:crypto'
import { claudeLaunchFlags } from '../../configuration/launch-flags.js'
import { claudeAuthenticated, claudeCommand } from '../../configuration/claude-command.js'
import { decode, goalCommandText } from '@dovo/protocol'
import { requireClaudeGoal } from './claude-goal.js'
import { claudeMcpConfigFile, claudeMcpServers } from '../../configuration/mcp-settings.js'
import { claudeInput, claudeMessage } from './claude-input.js'
import { Schema } from 'effect'
import { claudeModels } from '../../catalogs/claude.js'
import { claudeQuestions } from './claude-questions.js'
import { formQuestions } from '../shared/form-questions.js'
import {
  query,
  type Options,
  type AccountInfo,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { AgentAdapter, AgentRun } from '../../execution/types.js'
import { processEnvironment } from '../../../process.js'
import {
  claudeEffectiveEnvironment,
  claudeSubscriptionEnvironment,
} from '../../configuration/claude-settings.js'
import { ClaudePrewarmer, type ClaudeBinding } from './claude-prewarm.js'
import { IdleProviders, releaseIdleProvider } from '../../execution/warm-processes.js'
import { updateSubagents } from '../../execution/subagents.js'
import { nativeAgentWorking, type Subagent } from '@dovo/protocol'
import { readClaudeThread } from './claude-thread.js'
import { ClaudeBackgroundTasks } from './claude-background-tasks.js'
import { isContextRejection } from '../../execution/handover.js'

class ClaudeContextRejection extends Error {}
function rejectedContext(message: SDKMessage) {
  if (message.type !== 'result' || (message.subtype === 'success' && !message.is_error)) return
  const text = message.subtype === 'success' ? message.result : message.errors.join('\n')
  if (message.terminal_reason === 'prompt_too_long' || isContextRejection(new Error(text)))
    return new ClaudeContextRejection(
      message.terminal_reason === 'prompt_too_long' ? `prompt_too_long: ${text}` : text,
    )
}
function contextErrorAssistant(message: SDKMessage) {
  // The SDK also represents a rejected API request as a synthetic assistant.
  // Its explicit error metadata distinguishes it from actual model output.
  return (
    message.type === 'assistant' &&
    message.error === 'invalid_request' &&
    message.parent_tool_use_id == null &&
    message.message.content.every((block) => block.type === 'text') &&
    isContextRejection(
      new Error(
        message.message.content
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('\n'),
      ),
    )
  )
}

function claudeToolDisposition(run: AgentRun, name: string) {
  if (
    name === 'AskUserQuestion' ||
    ([
      'mcp__dovo_task__ask_question',
      'mcp__dovo_task__todos',
      'mcp__dovo_task__skill_read',
    ].includes(name) &&
      run.taskId &&
      run.agent.resources?.mcpServers.some(
        (server) =>
          server.enabled &&
          server.name === 'dovo_task' &&
          server.envValues?.DOVO_TASK_ID === run.taskId,
      ))
  )
    return run.tools === 'none' ? 'deny' : 'allow'
  return toolPolicyDisposition(
    run,
    ['Read', 'Glob', 'Grep', 'ToolSearch'].includes(name) ? 'read' : 'other',
  )
}

function claudeOptions(
  run: AgentRun,
  controller: AbortController,
  binding: ClaudeBinding,
  command: string,
  mcpConfigPath?: string,
): Options {
  return {
    spawnClaudeCodeProcess: (options) => {
      const child = spawn(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      child.stderr.resume()
      binding.child = child
      binding.activeRun()?.onOwnedProcess?.(child)
      const stop = () => {
        void stopOwnedChild(child).catch((error: unknown) =>
          console.error('Could not stop Claude process tree:', error),
        )
      }
      options.signal.addEventListener('abort', stop, { once: true })
      child.once('close', () => options.signal.removeEventListener('abort', stop))
      if (options.signal.aborted) stop()
      return child
    },
    cwd: run.cwd,
    ...(run.linkedDirectories?.length
      ? { additionalDirectories: run.linkedDirectories.map((item) => item.path) }
      : {}),
    env: processEnvironment({
      ...(run.tools === 'none'
        ? claudeEffectiveEnvironment(run.agent.env, run.cwd, run.agent.args)
        : run.agent.env),
      ...(run.tools === 'none' || run.agent.cloudIntegrations !== undefined
        ? {
            ENABLE_CLAUDEAI_MCP_SERVERS: String(
              run.tools !== 'none' && run.agent.cloudIntegrations,
            ),
          }
        : {}),
    }),
    extraArgs: {
      ...Object.fromEntries(
        Object.entries(claudeLaunchFlags(run.agent.args)).filter(
          ([key]) =>
            run.tools !== 'none' ||
            !['settings', 'setting-sources', 'managed-settings'].includes(key),
        ),
      ),
      ...(mcpConfigPath ? { 'mcp-config': mcpConfigPath } : {}),
    },
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
            Schema.Literals(['low', 'medium', 'high', 'xhigh', 'max']),
            run.agent.reasoning,
          ),
        }
      : {}),
    pathToClaudeCodeExecutable: command,
    ...(run.ephemeral ? { persistSession: false } : {}),
    ...(run.outputSchema
      ? { outputFormat: { type: 'json_schema' as const, schema: run.outputSchema } }
      : {}),
    systemPrompt:
      run.tools === 'none'
        ? run.agent.instructions
        : {
            type: 'preset',
            preset: 'claude_code',
            append: run.agent.instructions,
          },
    permissionMode:
      run.agent.permission === 'read-only'
        ? 'default'
        : run.agent.approvalPolicy === 'on-request'
          ? 'default'
          : run.agent.approvalPolicy === 'never' || run.agent.permission === 'full-access'
            ? 'bypassPermissions'
            : run.agent.permission === 'auto'
              ? 'auto'
              : run.agent.permission === 'workspace-write'
                ? 'acceptEdits'
                : 'default',
    ...((run.agent.approvalPolicy === 'never' && run.agent.permission !== 'read-only') ||
    (!run.agent.approvalPolicy && run.agent.permission === 'full-access')
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
      : {}),
    // Coding sessions inherit Claude settings; text-only utilities stay isolated.
    settingSources: run.tools === 'none' ? [] : ['user', 'project', 'local'],
    includePartialMessages: true,
    ...(run.tools === 'none'
      ? {}
      : {
          hooks: {
            // Settings allow rules can skip canUseTool. A pre-use deny still
            // enforces Studio's read-only policy before the tool executes.
            PreToolUse: [
              {
                hooks: [
                  async (input, _toolUseId, options) => {
                    if (input.hook_event_name !== 'PreToolUse') return {}
                    const current = binding.activeRun(input.agent_id, options.signal)
                    if (current && claudeToolDisposition(current, input.tool_name) !== 'deny')
                      return {}
                    return {
                      hookSpecificOutput: {
                        hookEventName: 'PreToolUse',
                        permissionDecision: 'deny',
                        permissionDecisionReason: 'Permission denied in Dovo Studio',
                      },
                    }
                  },
                ],
              },
            ],
            PostToolUse: [
              {
                matcher: 'TodoWrite|TaskCreate|TaskUpdate|TaskList|TaskGet',
                hooks: [
                  async (input, _toolUseId, options) => {
                    if (input.hook_event_name === 'PostToolUse' && !input.agent_id)
                      binding
                        .activeRun(undefined, options.signal)
                        ?.onEvent?.('claude/checklist', input)
                    return {}
                  },
                ],
              },
            ],
          },
        }),
    onElicitation: async (request, options) => {
      const current = binding.activeRun(undefined, options.signal, true)
      if (!current) return { action: 'decline' }
      if (request.mode !== 'form' && request.mode !== undefined) {
        current.onActivity('This Claude MCP input request is not a supported form')
        return {
          action: 'cancel',
        }
      }
      const content = await formQuestions(
        request.message,
        request.requestedSchema,
        current,
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
          tools: ['Read', 'Glob', 'Grep', 'ToolSearch', 'AskUserQuestion'],
        }
      : {}),
    canUseTool: async (name, input, options) => {
      if (run.tools === 'none')
        return {
          behavior: 'deny',
          message: 'Tools are disabled for text cleanup',
        }
      const current = binding.activeRun(options.agentID, options.signal)
      if (!current) return { behavior: 'deny', message: 'This Claude request has no active owner' }
      if (name === 'AskUserQuestion')
        return claudeQuestions(input, current, options.signal, binding.capabilities.unanswered)
      const disposition = claudeToolDisposition(current, name)
      const allowed =
        disposition === 'allow' ||
        (disposition === 'ask' &&
          (await current.approve(
            name,
            JSON.stringify(input, null, 2),
            ['WebFetch', 'WebSearch'].includes(name)
              ? 'web'
              : name === 'Bash'
                ? 'command'
                : undefined,
          )) !== 'deny')
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
  }
}
function handleMessage(
  run: AgentRun,
  message: SDKMessage,
  compacted: () => void,
  intermediate = false,
) {
  if (message.type === 'system' && message.subtype === 'compact_boundary') compacted()
  const rejection = rejectedContext(message)
  if (
    (message.type === 'assistant' && !contextErrorAssistant(message)) ||
    message.type === 'stream_event' ||
    (message.type === 'result' && !rejection)
  )
    run.onPromptAccepted?.()
  run.onEvent?.(message.type, message)
  if (
    run.goal &&
    message.type === 'result' &&
    message.subtype === 'success' &&
    message.local_command === 'goal'
  )
    run.onText(message.result)
  if (message.session_id) run.onSession(message.session_id)
  if (
    message.type === 'stream_event' &&
    message.event.type === 'content_block_delta' &&
    message.event.delta.type === 'text_delta'
  )
    run.onText(message.event.delta.text)
  if (message.type === 'stream_event' && message.event.type === 'message_stop')
    run.onTextBoundary?.()
  if (message.type === 'assistant')
    for (const block of message.message.content)
      if (
        block.type === 'tool_use' ||
        block.type === 'server_tool_use' ||
        block.type === 'mcp_tool_use'
      )
        run.onActivity(block.name)
  if (intermediate) return
  if (rejection) throw rejection
  if (
    message.type === 'result' &&
    (message.terminal_reason === 'aborted_streaming' || message.terminal_reason === 'aborted_tools')
  )
    throw new Error('Claude turn interrupted')
  if (message.type === 'result' && message.subtype !== 'success')
    throw new Error(message.errors.join('\n'))
  if (message.type === 'result' && message.subtype === 'success' && message.is_error)
    throw new Error(message.result)
  if (
    run.outputSchema &&
    message.type === 'result' &&
    message.subtype === 'success' &&
    message.structured_output !== undefined
  ) {
    // The SDK delivers canonical structured output separately from streamed prose.
    run.onTextBoundary?.()
    run.onText(JSON.stringify(message.structured_output))
  }
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
  steered: boolean
  workStarted: boolean
  resolve: () => void
  reject: (error: Error) => void
}
type WarmClaude = {
  process: ClaudeBinding
  stream: ReturnType<typeof query>
  input: MessageQueue
  controller: AbortController
  turn?: WarmTurn
  sessionId?: string
  cwd: string
  command: string
  config: string
  mcpBinding: string
  disposeMcpConfig: () => void
  taskId: string
  consumer: Promise<void>
  closed: boolean
  closing?: Promise<void>
  accountInfo?: Promise<AccountInfo | undefined>
  onSubagentEvent?: AgentRun['onSubagentEvent']
  owner: AgentRun
  nativeAgents: Subagent[]
  backgroundTasks: ClaudeBackgroundTasks
}

export function createClaudeAdapter(): AgentAdapter {
  const idle = new IdleProviders<WarmClaude>(
    (session) => close(session),
    (session) => session.nativeAgents.some(nativeAgentWorking),
  )
  const active = new Set<WarmClaude>()
  const spares = new ClaudePrewarmer()
  const publish = (session: WarmClaude, owner: AgentRun) => {
    if (session.sessionId)
      owner.onNativeSession?.(
        {
          stop: async (id) => {
            for (const agent of session.nativeAgents.filter(
              (agent) => nativeAgentWorking(agent) && !agent.workflowId && (!id || agent.id === id),
            ))
              await session.stream.stopTask(agent.id)
          },
        },
        session.sessionId,
      )
  }
  const close = (session: WarmClaude): Promise<void> => {
    if (session.closing) return session.closing
    if (session.closed) return session.consumer
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
      if (session.process.child) await stopOwnedChild(session.process.child)
      session.disposeMcpConfig()
      session.onSubagentEvent?.('dovo/session/closed', {}, session.sessionId)
      if (closeError) throw closeError
    })()
    return session.closing
  }
  const runWarm = async (run: AgentRun, command: string) => {
    if (!run.taskId) throw new Error('Warm Claude turn needs a task')
    const config = JSON.stringify(
      [run.agent, run.tools, run.linkedDirectories],
      (key, value: unknown) => (key === 'DOVO_TASK_RUN_ID' ? undefined : value),
    )
    const mcpServers = claudeMcpServers(run.agent.resources?.mcpServers ?? [])
    const mcpBinding = JSON.stringify(mcpServers)
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
    if (previous && !reusable) {
      if (previous.nativeAgents.some(nativeAgentWorking)) {
        idle.set(run.taskId, previous)
        throw new Error('Stop native Claude agents before changing their session configuration')
      }
      await close(previous)
    }
    let session: WarmClaude
    if (reusable) session = reusable
    else {
      const input = new MessageQueue()
      const controller = new AbortController()
      const currentRun = (
        agentId?: string,
        signal?: AbortSignal,
        sessionRequest = false,
      ): AgentRun | undefined => {
        if (!session) return run.signal.aborted || signal?.aborted ? undefined : run
        if (session.closed || session.controller.signal.aborted || signal?.aborted) return
        if (session.turn) return session.turn.run
        const owner = session.owner
        if (
          (!agentId && (!sessionRequest || !session.nativeAgents.some(nativeAgentWorking))) ||
          !signal ||
          !owner.nativeAgentInteractions ||
          (agentId &&
            !session.nativeAgents.some(
              (agent) => agent.id === agentId && nativeAgentWorking(agent),
            ))
        )
          return
        const interactions = owner.nativeAgentInteractions
        return {
          ...owner,
          approve: (
            title: string,
            detail: string,
            kind?: 'web' | 'command',
            options?: { session?: boolean; always?: boolean },
          ) =>
            interactions.approve(
              title,
              detail,
              AbortSignal.any([session.controller.signal, signal]),
              kind,
              options,
            ),
          ask: (prompt, questionSignal, validate, onUnanswered) =>
            interactions.ask(
              prompt,
              AbortSignal.any([session.controller.signal, questionSignal ?? signal]),
              validate,
              onUnanswered,
            ),
        }
      }
      const capabilities = { unanswered: false }
      const configFile = claudeMcpConfigFile(run.agent.resources?.mcpServers ?? [])
      let stream: ReturnType<typeof query> | undefined
      const binding: ClaudeBinding = { activeRun: currentRun, capabilities }
      const abortStartup = () => {
        controller.abort()
        stream?.close()
      }
      run.signal.addEventListener('abort', abortStartup, { once: true })
      try {
        const options = claudeOptions(run, controller, binding, command, configFile.path)
        // Only an empty input queue is claimed. No prompt runs before MCP ownership is rebound.
        const claimed =
          !run.sessionId && !run.compact
            ? await spares.claim(options, binding, input, run.signal)
            : undefined
        if (run.signal.aborted) {
          claimed?.close()
          run.signal.throwIfAborted()
        }
        stream = claimed ?? query({ prompt: input, options })
        if (claimed) {
          const result = await stream.setMcpServers(mcpServers)
          if (Object.keys(result.errors).length) {
            stream.close()
            throw new Error('Claude prewarm MCP binding failed')
          }
        }
        if (!run.compact)
          spares.remember(() => {
            let owner: ClaudeBinding = {
              activeRun: () => undefined,
              capabilities: { unanswered: false },
            }
            const parked: ClaudeBinding = {
              activeRun: (...args) => owner.activeRun(...args),
              capabilities: owner.capabilities,
            }
            return {
              options: claudeOptions(run, new AbortController(), parked, command),
              bind: (next) => {
                next.child = parked.child
                if (next.child) next.activeRun()?.onOwnedProcess?.(next.child)
                owner = next
                parked.capabilities = next.capabilities
              },
            }
          })
      } catch (error) {
        try {
          stream?.close()
        } finally {
          controller.abort()
          configFile.dispose()
          if (binding.child) await stopOwnedChild(binding.child)
        }
        throw error
      } finally {
        run.signal.removeEventListener('abort', abortStartup)
      }
      session = {
        process: binding,
        stream,
        input,
        controller,
        cwd: run.cwd,
        command,
        config,
        mcpBinding,
        disposeMcpConfig: configFile.dispose,
        taskId: run.taskId,
        sessionId: run.sessionId,
        consumer: Promise.resolve(),
        closed: false,
        onSubagentEvent: run.onSubagentEvent,
        owner: run,
        nativeAgents: [],
        backgroundTasks: new ClaudeBackgroundTasks(),
      }
      active.add(session)
      session.consumer = (async () => {
        try {
          for await (const message of stream) {
            if (message.type === 'system' && message.subtype === 'init')
              capabilities.unanswered =
                message.capabilities?.includes('ask_user_question_unanswered_v1') ?? false
            if (session.closed) break
            const turn = session.turn
            session.backgroundTasks.accept(message)
            if (message.session_id) {
              session.sessionId = message.session_id
              turn?.run.onSession(message.session_id)
              if (turn) publish(session, turn.run)
            }
            session.nativeAgents = updateSubagents(
              session.nativeAgents,
              'claude',
              message,
              new Date().toISOString(),
              message.type,
              session.sessionId,
            )
            session.onSubagentEvent?.(message.type, message, session.sessionId)
            if (!turn) {
              // Native background work can produce a root reply after the user turn has ended.
              // Persist the canonical message through the session-owned callback, not retired turn hooks.
              if (message.type === 'assistant' && message.parent_tool_use_id == null) {
                const text = message.message.content
                  .flatMap((block) => (block.type === 'text' ? [block.text] : []))
                  .join('')
                if (text)
                  session.onSubagentEvent?.(
                    'dovo/session/message',
                    { id: message.uuid, text },
                    session.sessionId,
                  )
              }
              continue
            }
            try {
              if (
                (message.type === 'assistant' && !contextErrorAssistant(message)) ||
                message.type === 'stream_event'
              )
                turn.workStarted = true
              const intermediate =
                turn.steered &&
                !turn.run.signal.aborted &&
                message.type === 'result' &&
                (message.terminal_reason === 'aborted_streaming' ||
                  message.terminal_reason === 'aborted_tools')
              handleMessage(turn.run, message, () => (turn.compacted = true), intermediate)
              if (intermediate) continue
              if (message.type === 'result') {
                if (turn.run.compact && !turn.compacted)
                  throw new Error('Claude did not report a completed compaction')
                turn.run.onNativeTurnEnd?.()
                turn.run.onSteer?.(undefined)
                session.turn = undefined
                turn.resolve()
              }
            } catch (error) {
              session.turn = undefined
              turn.reject(error instanceof Error ? error : new Error(String(error)))
              // This result rejects just the submitted prompt, not the streaming
              // session. Keep consuming native jobs and their completion events.
              if (error instanceof ClaudeContextRejection && !turn.workStarted && !turn.steered)
                continue
              throw error
            }
          }
          throw new Error('Claude connection ended')
        } catch (error) {
          session.turn?.reject(error instanceof Error ? error : new Error(String(error)))
          session.turn = undefined
          // Explicit shutdown owns stream closure and the final session notification.
          if (session.closed) return
          session.closed = true
          session.onSubagentEvent?.('dovo/session/closed', {}, session.sessionId)
          active.delete(session)
          idle.delete(session.taskId)
          session.input.close()
          session.disposeMcpConfig()
          try {
            stream.close()
          } catch (closeError) {
            console.error('Could not close Claude stream:', closeError)
          }
          if (binding.child) await stopOwnedChild(binding.child)
        }
      })()
      void session.consumer.catch((error) => console.error('Claude stream failed:', error))
    }
    if (session.process.child) run.onOwnedProcess?.(session.process.child)
    session.onSubagentEvent = run.onSubagentEvent
    session.owner = run
    publish(session, run)
    const completion = new Promise<void>((resolve, reject) => {
      session.turn = { run, compacted: false, steered: false, workStarted: false, resolve, reject }
    })
    const turn = session.turn
    const abort = () => {
      session.turn?.reject(new Error('Task cancelled'))
      void close(session).catch((error) => console.error('Could not stop Claude:', error))
    }
    run.signal.addEventListener('abort', abort, { once: true })
    try {
      run.signal.throwIfAborted()
      const accountInfo = (session.accountInfo ??=
        typeof session.stream.accountInfo === 'function'
          ? session.stream.accountInfo().catch((error) => {
              console.warn(
                'Claude account metadata unavailable:',
                error instanceof Error ? error.message : String(error),
              )
              session.accountInfo = undefined
              return undefined
            })
          : Promise.resolve(undefined))
      // Optional account metadata must not hold a completed reply open. Never
      // publish a late response into a completed, cancelled or subsequent turn.
      void accountInfo
        .then((account) => {
          const env = claudeEffectiveEnvironment(run.agent.env, run.cwd, run.agent.args)
          if (
            session.turn?.run === run &&
            !run.signal.aborted &&
            !session.closed &&
            account &&
            claudeSubscriptionEnvironment(env)
          )
            run.onEvent?.('account/info', account)
        })
        .catch((error) => console.warn('Could not report Claude account metadata:', error))
      // Observe both promises immediately so a failed turn cannot become an unhandled rejection.
      await Promise.all([
        completion,
        (async () => {
          // Rebind attempt ownership without restarting the provider or removing host settings.
          if (session.mcpBinding !== mcpBinding) {
            const result = await session.stream.setMcpServers(mcpServers)
            const errors = Object.entries(result.errors)
            if (errors.length)
              throw new Error(
                `Claude MCP configuration failed: ${errors.map(([name, error]) => `${name}: ${error}`).join('; ')}`,
              )
            session.mcpBinding = mcpBinding
          }
          await requireClaudeGoal(session.stream, run)
          run.signal.throwIfAborted()
          session.input.push(claudeMessage(run))
          if (!run.compact)
            run.onSteer?.(async (input) => {
              const checkActive = () => {
                run.signal.throwIfAborted()
                if (!turn || session.turn !== turn || session.closed)
                  throw new Error('The Claude turn finished. Send this as a follow-up instead.')
                return turn
              }
              checkActive()
              const message: SDKUserMessage = {
                ...claudeMessage({ ...run, ...input, sessionId: session.sessionId }),
                uuid: randomUUID(),
                priority: 'now',
              }
              await session.backgroundTasks.preserve(session.stream, run.signal)
              const current = checkActive()
              current.steered = true
              session.input.push(message)
            })
        })(),
      ])
      if (session.sessionId && !session.closed && !session.controller.signal.aborted) {
        idle.set(run.taskId, session)
        await idle.prune(releaseIdleProvider())
        spares.prepare()
      } else await close(session)
    } catch (error) {
      session.turn = undefined
      if (
        error instanceof ClaudeContextRejection &&
        !turn?.workStarted &&
        !turn?.steered &&
        !session.closed &&
        !session.controller.signal.aborted &&
        !run.signal.aborted
      )
        idle.set(run.taskId, session)
      else await close(session)
      throw error
    } finally {
      run.onSteer?.(undefined)
      run.signal.removeEventListener('abort', abort)
    }
  }
  return {
    readNativeThread: readClaudeThread,
    releaseTask: (taskId) => idle.release(taskId),
    models: claudeModels,
    probe: async (agent) => ({
      provider: 'claude',
      available: await claudeAuthenticated(agent),
      detail:
        'Requires Claude CLI authenticated on this runtime host, using a Claude login or supported API credentials.',
    }),
    async run(run) {
      run = checkedPolicyRun(run, 'claude')
      if (run.goal) run = { ...run, prompt: goalCommandText(run.goal) }
      const command = await claudeCommand(run.agent.endpoint, run.agent.env)
      if (run.taskId && run.tools !== 'none') return runWarm(run, command)
      const controller = new AbortController(),
        abort = () => controller.abort()
      run.signal.addEventListener('abort', abort, {
        once: true,
      })
      if (run.signal.aborted) abort()
      const configFile = claudeMcpConfigFile(
        run.tools === 'none' ? [] : (run.agent.resources?.mcpServers ?? []),
      )
      let stream: ReturnType<typeof query> | undefined
      const capabilities = { unanswered: false }
      const binding: ClaudeBinding = { activeRun: () => run, capabilities }
      try {
        const goalInput = run.goal ? new MessageQueue() : undefined
        stream = query({
          prompt: goalInput ?? (run.attachments?.length ? claudeInput(run) : run.prompt),
          options: claudeOptions(run, controller, binding, command, configFile.path),
        })
        if (goalInput) {
          await requireClaudeGoal(stream, run)
          goalInput.push(claudeMessage(run))
          goalInput.close()
        }
        let compacted = false
        for await (const message of stream) {
          if (message.type === 'system' && message.subtype === 'init')
            capabilities.unanswered =
              message.capabilities?.includes('ask_user_question_unanswered_v1') ?? false
          handleMessage(run, message, () => (compacted = true))
        }
        if (run.compact && !compacted)
          throw new Error('Claude did not report a completed compaction')
      } finally {
        run.signal.removeEventListener('abort', abort)
        try {
          stream?.close()
        } finally {
          configFile.dispose()
          if (binding.child) await stopOwnedChild(binding.child)
        }
      }
    },
    dispose: async () => {
      await Promise.all([spares.dispose(), ...[...active].map(close)])
    },
  }
}
export const claudeAdapter = createClaudeAdapter()
