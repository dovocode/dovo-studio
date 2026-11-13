import { configureAcpV2 } from './acp-v2-config.js'
import {
  SessionUpdate,
  RequestPermissionSubject,
  type NewSessionResponse,
  type ResumeSessionResponse,
} from '@agentclientprotocol/sdk/experimental/v2'
import { isImageAttachment } from '@dovo/protocol'
import type { AgentRun, AcpLaunch } from '../../execution/types.js'
import { acpMcpServers } from '../../configuration/mcp-settings.js'
import { checkedPolicyRun, toolPolicyDisposition } from '../shared/permission-policy.js'
import { formQuestions } from '../shared/form-questions.js'
import { IdleProviders, releaseIdleProvider } from '../../execution/warm-processes.js'
import { openAcpV2Connection, AcpV1Fallback } from './acp-v2-connection.js'
import { AcpV2Updates } from './acp-v2-updates.js'

type Connection = ReturnType<typeof openAcpV2Connection>
type Session = NewSessionResponse | ResumeSessionResponse

type Warm = {
  connection: Connection
  session: Session
  sessionId: string
  key: string
  image: boolean
  state: {
    run: AgentRun
    updates?: AcpV2Updates
    prompting: boolean
    compact: boolean
    foreground?: string
    idle?: () => void
    fail?: (message: string) => void
  }
}

function working(value: Warm) {
  return (
    !!value.state.updates?.background ||
    (!!value.state.foreground && value.state.foreground !== 'idle')
  )
}

export function createAcpV2Adapter() {
  const close = async (value: Warm) => {
    await value.connection.close()
    value.state.run.onSubagentEvent?.('dovo/session/closed', {}, value.sessionId)
  }
  const idle = new IdleProviders<Warm>(close, working)
  return {
    releaseTask: (taskId: string) => idle.release(taskId),
    beforeV1: async (taskId: string) => {
      const held = idle.get(taskId)
      if (held && working(held))
        throw new Error('Stop ACP background work before changing protocol versions')
      await idle.release(taskId)
    },
    dispose: async () => {
      const values = [...idle.values()]
      idle.clear()
      await Promise.all(values.map(close))
    },
    /** False means explicit v1 negotiation. No session or prompt has been sent. */
    async run(input: AgentRun, launch: AcpLaunch): Promise<boolean> {
      const run = checkedPolicyRun(input, 'acp')
      run.signal.throwIfAborted()
      const key = JSON.stringify([launch, run.agent, run.tools, run.cwd])
      const previous = run.taskId ? idle.get(run.taskId) : undefined
      if (run.taskId) idle.delete(run.taskId)
      let warm =
        previous?.key === key &&
        previous.sessionId === run.sessionId &&
        !previous.connection.signal.aborted
          ? previous
          : undefined
      if (previous && !warm) {
        if (working(previous)) {
          if (run.taskId) idle.set(run.taskId, previous)
          throw new Error('Stop ACP background work before changing its session configuration')
        }
        await close(previous)
      }
      const state: Warm['state'] = warm?.state ?? { run, prompting: false, compact: false }
      state.run = run
      let sessionId = warm?.sessionId ?? run.sessionId
      let loading = !warm
      let cancelling = false
      const connection =
        warm?.connection ??
        openAcpV2Connection(
          launch,
          {
            permission: async ({ params }) => {
              const owner = state.run
              if (!state.prompting || params.sessionId !== sessionId || owner.signal.aborted)
                return { outcome: { outcome: 'cancelled' } }
              const subject = params.subject
              let operation: 'read' | 'edit' | 'execute' | 'other' = 'other'
              if (subject && RequestPermissionSubject.isToolCall(subject)) {
                state.updates?.tool(subject.toolCall, params.sessionId)
                const kind = subject.toolCall.kind
                operation = ['read', 'search', 'think'].includes(kind ?? '')
                  ? 'read'
                  : kind === 'edit'
                    ? 'edit'
                    : 'other'
              } else if (subject && RequestPermissionSubject.isCommand(subject))
                operation = 'execute'
              const disposition = toolPolicyDisposition(owner, operation)
              const allow =
                disposition === 'allow' ||
                (disposition === 'ask' &&
                  (await owner.approve(
                    params.title,
                    [params.description, JSON.stringify(subject, null, 2)]
                      .filter(Boolean)
                      .join('\n'),
                    operation === 'execute' ? 'command' : undefined,
                  )) !== 'deny')
              if (owner.signal.aborted || !state.prompting)
                return { outcome: { outcome: 'cancelled' } }
              const option = params.options.find(
                (option) => option.kind === (allow ? 'allow_once' : 'reject_once'),
              )
              return {
                outcome: option
                  ? { outcome: 'selected', optionId: option.optionId }
                  : { outcome: 'cancelled' },
              }
            },
            elicitation: async ({ params }) => {
              const owner = state.run
              if (
                !state.prompting ||
                !('sessionId' in params) ||
                params.sessionId !== sessionId ||
                owner.signal.aborted ||
                params.mode !== 'form'
              )
                return { action: 'cancel' }
              const content = await formQuestions(
                params.message,
                params.requestedSchema,
                owner,
                owner.signal,
              )
              if (owner.signal.aborted || !state.prompting) return { action: 'cancel' }
              return content ? { action: 'accept', content } : { action: 'decline' }
            },
            update: (params) => {
              if (params.sessionId !== sessionId) return
              if (SessionUpdate.isStateUpdate(params.update)) {
                state.foreground = params.update.state
                if (params.update.state === 'idle') state.idle?.()
              }
              if (SessionUpdate.isAvailableCommandsUpdate(params.update))
                state.compact = params.update.availableCommands.some(
                  (command) => command.name === 'compact',
                )
              if (!loading) {
                try {
                  state.updates?.accept(params, state.prompting)
                } catch (error) {
                  state.fail?.(error instanceof Error ? error.message : String(error))
                }
              }
            },
          },
          run.cwd,
        )
      run.onOwnedProcess?.(connection.child)
      if (!warm)
        void connection.exited.catch(() => {
          for (const [taskId, value] of idle)
            if (value.connection === connection) idle.delete(taskId)
          if (sessionId) state.run.onSubagentEvent?.('dovo/session/closed', {}, sessionId)
        })
      let succeeded = false
      let ephemeralDelete = false
      let abortTimer: ReturnType<typeof setTimeout> | undefined
      const abort = () => {
        cancelling = true
        if (sessionId) {
          void connection.rpc.notify('session/cancel', { sessionId }).catch(() => {})
          abortTimer = setTimeout(() => {
            void connection.close()
          }, 1500)
          abortTimer.unref()
        } else void connection.close()
      }
      const waitForIdle = async () => {
        if (!state.foreground || state.foreground === 'idle') return
        run.onActivity('Waiting for the existing ACP foreground work to finish')
        const ready = new Promise<void>((resolve) => {
          state.idle = resolve
        })
        try {
          await Promise.race([ready, connection.exited])
        } finally {
          state.idle = undefined
        }
        run.signal.throwIfAborted()
      }
      run.signal.addEventListener('abort', abort, { once: true })
      try {
        if (!warm) {
          let initialization
          try {
            initialization = await connection.initialize()
          } catch (error) {
            if (error instanceof AcpV1Fallback) return false
            throw error
          }
          const capabilities = initialization.capabilities?.session
          if (!capabilities) throw new Error('This ACP v2 agent does not support sessions')
          ephemeralDelete = !!capabilities.delete
          if (run.ephemeral && !ephemeralDelete)
            throw new Error('This ACP v2 agent cannot delete temporary sessions')
          const mcpServers = acpMcpServers(run.agent.resources?.mcpServers ?? []).map((server) =>
            server.type === 'http' ? server : { ...server, type: 'stdio' as const },
          )
          for (const server of mcpServers) {
            const kind = 'type' in server ? server.type : 'stdio'
            if (
              (kind === 'stdio' && !capabilities.mcp?.stdio) ||
              (kind === 'http' && !capabilities.mcp?.http)
            )
              throw new Error(`This ACP v2 agent does not support ${kind} MCP servers`)
          }
          const session = await connection.control(
            run.sessionId
              ? connection.rpc.request('session/resume', {
                  sessionId: run.sessionId,
                  cwd: run.cwd,
                  mcpServers,
                })
              : connection.rpc.request('session/new', { cwd: run.cwd, mcpServers }),
            'session setup',
          )
          const returnedId = 'sessionId' in session ? session.sessionId : undefined
          sessionId = run.sessionId ?? (typeof returnedId === 'string' ? returnedId : undefined)
          if (!sessionId) throw new Error('ACP v2 agent did not return a session id')
          state.compact =
            session.availableCommands?.some((command) => command.name === 'compact') ??
            state.compact
          warm = { connection, session, sessionId, key, state, image: !!capabilities.prompt?.image }
          const id = sessionId
          await waitForIdle()
          await configureAcpV2(
            connection,
            id,
            session.configOptions,
            run.agent,
            run.tools === 'none',
          )
        }
        run.signal.throwIfAborted()
        run.onSession(warm.sessionId)
        const id = warm.sessionId
        run.onNativeSession?.(
          {
            stop: async (childId) => {
              if (childId) throw new Error('ACP v2 native child control is not enabled')
              try {
                await connection.control(
                  connection.rpc.request('session/close', { sessionId: id }),
                  'session close',
                )
              } finally {
                await connection.close()
                if (run.taskId) idle.delete(run.taskId)
                run.onSubagentEvent?.('dovo/session/closed', {}, id)
              }
            },
          },
          id,
        )
        await waitForIdle()
        loading = false
        if (run.compact && !state.compact)
          throw new Error('This ACP agent does not advertise a compact command')
        let finish: (reason: string, error?: string) => void = () => {}
        const finished = new Promise<{ reason: string; error?: string }>((resolve) => {
          finish = (reason, error) => resolve({ reason, error })
        })
        if (state.updates) state.updates.begin(run, finish)
        else state.updates = new AcpV2Updates(run, finish)
        state.fail = (message) => finish('error', message)
        state.prompting = true
        // The response only acknowledges insertion. Only a subsequent foreground idle state ends work.
        await Promise.race([
          connection.rpc.request('session/prompt', {
            sessionId: warm.sessionId,
            prompt: [
              ...(warm.image
                ? (run.attachments ?? []).filter(isImageAttachment).map((file) => ({
                    type: 'image' as const,
                    data: file.data,
                    mimeType: file.mime,
                  }))
                : []),
              {
                type: 'text',
                text: run.compact
                  ? '/compact'
                  : [run.agent.instructions, run.prompt].filter(Boolean).join('\n\n'),
              },
            ],
          }),
          connection.exited,
        ])
        run.onPromptAccepted?.()
        if (!warm.image && run.attachments?.some(isImageAttachment))
          run.onActivity('ACP v2 attachments are available as files in the prompt context.')
        const result = await Promise.race([finished, connection.exited])
        if (result.reason !== 'end_turn' && !(cancelling && result.reason === 'cancelled'))
          throw new Error(result.error ?? `ACP v2 stopped: ${result.reason}`)
        run.onTextBoundary?.()
        if (run.compact) run.onEvent?.('dovo/compaction/completed', { sessionId })
        run.onNativeTurnEnd?.()
        succeeded = true
        if (run.taskId && !run.ephemeral && run.tools !== 'none' && !run.signal.aborted) {
          idle.set(run.taskId, warm)
          await idle.prune(releaseIdleProvider())
        }
        return true
      } finally {
        state.prompting = false
        state.fail = undefined
        clearTimeout(abortTimer)
        run.signal.removeEventListener('abort', abort)
        if (
          !succeeded ||
          !run.taskId ||
          run.ephemeral ||
          run.tools === 'none' ||
          run.signal.aborted
        ) {
          try {
            if (sessionId && !connection.signal.aborted && !run.signal.aborted) {
              try {
                await connection.control(
                  connection.rpc.request('session/close', { sessionId }),
                  'session close',
                )
              } catch (error) {
                run.onActivity(
                  `ACP v2 session cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
                )
              }
            }
            if (
              run.ephemeral &&
              !run.sessionId &&
              sessionId &&
              ephemeralDelete &&
              !connection.signal.aborted
            )
              await connection.control(
                connection.rpc.request('session/delete', { sessionId }),
                'session deletion',
              )
          } finally {
            await connection.close()
          }
        }
      }
    },
  }
}
